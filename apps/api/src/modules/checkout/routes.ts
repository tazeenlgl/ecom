import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db/client.js';
import { carts, customerAddresses, customers, orderItems, orders, promotionRedemptions } from '../../db/schema.js';
import { actorOf } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors.js';
import { defineRoute, paise } from '../../lib/route.js';
import { findCart, loadCartLines } from '../cart/service.js';
import { enqueueJob } from '../jobs/queue.js';
import { addOrderEvent, nextOrderNumber, notifyOrder, schedulePosSync } from '../orders/service.js';
import { presentOrder } from '../orders/presenter.js';
import { refreshStockLive } from '../pos/stock.js';
import { lockAndRecheckPromotions } from '../promotions/loader.js';
import { buildQuote, presentQuote } from './quote.js';

const checkoutBody = z.object({
  addressId: z.uuid(),
  paymentMethod: z.enum(['online', 'cod']),
  /**
   * The total the customer was shown. If the server's total differs, the order
   * is not placed and the new quote is returned (409 price_changed).
   */
  expectedTotalPaise: paise,
});

async function loadAddress(ctx: AppContext, db: Tx | AppContext['db'], request: FastifyRequest, addressId: string) {
  const [address] = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.storeId, request.store.id), eq(customerAddresses.customerId, request.customer!.id)));
  if (!address) throw notFound('Address');
  return address;
}

/** Checkout requires a signed-in customer (OTP login); guest carts merge on sign-in. */
export function checkoutRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Storefront: checkout';

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/checkout/quote',
        summary: 'Price the cart for an address and payment method without placing an order',
        tag,
        auth: 'customer',
        body: checkoutBody.omit({ expectedTotalPaise: true }),
      },
      async (request, { body }) => {
        const cart = await findCart(ctx, request);
        if (!cart) throw notFound('Cart');
        const address = await loadAddress(ctx, ctx.db, request, body.addressId);
        const quote = await buildQuote(ctx.db, {
          store: request.store,
          cart,
          customerId: request.customer!.id,
          pincode: address.pincode,
          paymentMethod: body.paymentMethod,
          now: ctx.now(),
        });
        return { quote: presentQuote(quote) };
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/checkout/orders',
        summary: 'Place an order from the cart. Requires Idempotency-Key; retries with the same key return the same order',
        tag,
        auth: 'customer',
        status: 201,
        idempotencyKey: true,
        body: checkoutBody,
      },
      async (request, { body, idempotencyKey }, reply) => {
        const store = request.store;
        const customerId = request.customer!.id;
        const actor = actorOf(request);

        const cart = await findCart(ctx, request);
        const requestHash = sha256(JSON.stringify({ ...body, cartId: cart?.id ?? null }));

        const replay = async () => {
          const [existing] = await ctx.db
            .select()
            .from(orders)
            .where(and(eq(orders.storeId, store.id), eq(orders.customerId, customerId), eq(orders.idempotencyKey, idempotencyKey)));
          if (!existing) return null;
          if (existing.requestHash !== requestHash) {
            throw new AppError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
          }
          reply.status(200);
          return { order: await presentOrder(ctx.db, existing), replayed: true };
        };
        const previous = await replay();
        if (previous) return previous;
        if (!cart) throw notFound('Cart');

        // Refresh stock from the POS when it supports live reads (outside the transaction: network I/O).
        const lines = await loadCartLines(ctx.db, store.id, cart.id, store.posLocationRef);
        await refreshStockLive(ctx, store.posLocationRef, lines.map((l) => l.skuCode));

        try {
          return await ctx.db.transaction(async (tx) => {
            const [lockedCart] = await tx.select().from(carts).where(and(eq(carts.id, cart.id), eq(carts.status, 'active'))).for('update');
            if (!lockedCart) throw new AppError(409, 'conflict', 'This cart has already been checked out.');
            const address = await loadAddress(ctx, tx, request, body.addressId);
            const quote = await buildQuote(tx, {
              store,
              cart: lockedCart,
              customerId,
              pincode: address.pincode,
              paymentMethod: body.paymentMethod,
              now: ctx.now(),
            });
            if (quote.issues.length > 0) {
              throw new AppError(409, 'conflict', 'The cart cannot be checked out.', { issues: quote.issues, quote: presentQuote(quote) });
            }
            if (quote.totalPaise !== body.expectedTotalPaise) {
              throw new AppError(409, 'price_changed', 'Prices or offers changed. Please review the updated total.', { quote: presentQuote(quote) });
            }
            const promotionIds = quote.appliedPromotions.map((p) => p.promotionId);
            if (!(await lockAndRecheckPromotions(tx, promotionIds, customerId, quote.couponIds))) {
              throw new AppError(409, 'price_changed', 'An offer in your cart is no longer available. Please review the updated total.');
            }

            const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
            const cod = body.paymentMethod === 'cod';
            const [order] = await tx
              .insert(orders)
              .values({
                storeId: store.id,
                orderNumber: await nextOrderNumber(tx, { id: store.id, slug: store.slug, config: store.config }),
                customerId,
                status: cod ? 'confirmed' : 'pending_payment',
                paymentStatus: cod ? 'cod_pending' : 'unpaid',
                posSyncStatus: 'pending',
                paymentMethod: body.paymentMethod,
                currency: store.currency,
                subtotalPaise: quote.subtotalPaise,
                discountPaise: quote.discountPaise,
                shippingPaise: quote.shippingPaise,
                codFeePaise: quote.codFeePaise,
                taxPaise: quote.taxPaise,
                totalPaise: quote.totalPaise,
                customerSnapshot: { name: customer!.name, phone: customer!.phone, email: customer!.email },
                shippingAddress: {
                  name: address.name,
                  phone: address.phone,
                  line1: address.line1,
                  line2: address.line2,
                  landmark: address.landmark,
                  city: address.city,
                  state: address.state,
                  pincode: address.pincode,
                  country: address.country,
                },
                appliedPromotions: quote.appliedPromotions,
                idempotencyKey,
                requestHash,
                placedAt: ctx.now(),
              })
              .returning();

            await tx.insert(orderItems).values(
              quote.lines.map((l) => ({
                storeId: store.id,
                orderId: order!.id,
                variantId: l.variantId,
                productId: l.productId,
                skuCode: l.skuCode,
                productTitle: l.productTitle,
                variantTitle: l.variantTitle,
                options: l.options,
                imageUrl: l.imageUrl,
                quantity: l.quantity,
                mrpPaise: l.mrpPaise!,
                unitPricePaise: l.unitPricePaise!,
                discountPaise: l.discountPaise,
                taxRateBps: l.taxRateBps,
                taxPaise: l.taxPaise,
                lineTotalPaise: l.lineTotalPaise,
              })),
            );
            if (quote.appliedPromotions.length) {
              await tx.insert(promotionRedemptions).values(
                quote.appliedPromotions.map((p) => ({
                  storeId: store.id,
                  promotionId: p.promotionId,
                  couponId: quote.couponIds[p.promotionId] ?? null,
                  orderId: order!.id,
                  customerId,
                  discountPaise: p.discountPaise + p.shippingDiscountPaise,
                })),
              );
            }
            await tx.update(carts).set({ status: 'converted' }).where(eq(carts.id, lockedCart.id));
            await addOrderEvent(tx, order!, { machine: 'order', to: order!.status, actor, note: 'Order placed', isPublic: true });

            if (cod) {
              await schedulePosSync(ctx, tx, order!, actor);
              await notifyOrder(tx, order!, 'order.confirmed');
            } else {
              const ttl = store.config.unpaidOrderTtlMinutes ?? 30;
              await enqueueJob(tx, {
                type: 'orders.expire_unpaid',
                storeId: store.id,
                payload: { orderId: order!.id },
                idempotencyKey: `expire_unpaid:${order!.id}`,
                runAt: new Date(ctx.now().getTime() + ttl * 60_000),
              });
            }
            const [fresh] = await tx.select().from(orders).where(eq(orders.id, order!.id));
            return { order: await presentOrder(tx, fresh!), replayed: false };
          });
        } catch (err) {
          // A concurrent request with the same key won the race (unique key, or the cart
          // it converted): return that order.
          if (isUniqueViolation(err) || (err instanceof AppError && err.code === 'conflict' && !(err.details as object | undefined))) {
            const winner = await replay();
            if (winner) return winner;
          }
          throw err;
        }
      },
    );
  };
}

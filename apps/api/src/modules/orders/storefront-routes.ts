import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { orderEvents, orderItems, orders, paymentTransactions, returnRequests } from '../../db/schema.js';
import { actorOf } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { cursorCondition, pageQuery, toPage } from '../../lib/pagination.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { defineRoute } from '../../lib/route.js';
import { canTransition } from './state-machines.js';
import { presentOrder } from './presenter.js';
import { addOrderEvent, cancelOrder, lockOrder, transitionOrder } from './service.js';

const orderParams = z.object({ orderNumber: z.string().regex(/^[A-Z0-9]{1,8}-\d{6,}$/) });
const RETURN_WINDOW_DAYS = 7;

export function orderStorefrontRoutes(ctx: AppContext) {
  const paymentLimiter = new RateLimiter(20, 15 * 60_000);

  return async (app: FastifyInstance) => {
    const tag = 'Storefront: orders';

    // Every lookup is scoped to the resolved store AND the signed-in customer.
    const findOwnOrder = async (request: FastifyRequest, orderNumber: string) => {
      const [order] = await ctx.db
        .select()
        .from(orders)
        .where(and(eq(orders.storeId, request.store.id), eq(orders.customerId, request.customer!.id), eq(orders.orderNumber, orderNumber)));
      if (!order) throw notFound('Order');
      return order;
    };

    defineRoute(app, { method: 'GET', url: '/orders', summary: 'My orders', tag, auth: 'customer', query: pageQuery }, async (request, { query }) => {
      const rows = await ctx.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          fulfillmentStatus: orders.fulfillmentStatus,
          totalPaise: orders.totalPaise,
          placedAt: orders.placedAt,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(and(eq(orders.storeId, request.store.id), eq(orders.customerId, request.customer!.id), cursorCondition(query.cursor, orders.createdAt, orders.id)))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(query.limit + 1);
      return toPage(rows, query.limit);
    });

    defineRoute(app, { method: 'GET', url: '/orders/:orderNumber', summary: 'Order detail with items, timeline and shipments', tag, auth: 'customer', params: orderParams }, async (request, { params }) => ({
      order: await presentOrder(ctx.db, await findOwnOrder(request, params.orderNumber)),
    }));

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/orders/:orderNumber/cancel',
        summary: 'Cancel an order that has not been packed or shipped',
        tag,
        auth: 'customer',
        params: orderParams,
        body: z.object({ reason: z.string().min(1).max(500) }),
      },
      async (request, { params, body }) => {
        const own = await findOwnOrder(request, params.orderNumber);
        return ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, own.storeId, own.id);
          if (!['pending_payment', 'confirmed'].includes(order.status) || order.fulfillmentStatus !== 'unfulfilled') {
            throw new AppError(409, 'invalid_transition', 'This order can no longer be cancelled online. Please contact support.');
          }
          const updated = await cancelOrder(ctx, tx, order, actorOf(request), body.reason);
          return { order: await presentOrder(tx, updated) };
        });
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/orders/:orderNumber/payments',
        summary: 'Start an online payment for an unpaid order; returns provider data for the client SDK',
        tag,
        auth: 'customer',
        status: 201,
        rateLimit: paymentLimiter,
        params: orderParams,
      },
      async (request, { params }) => {
        const providerName = ctx.config.PAYMENT_PROVIDER;
        const provider = ctx.payments.get(providerName);
        if (!provider) throw new AppError(503, 'payment_error', 'Online payment is not available right now.');
        const own = await findOwnOrder(request, params.orderNumber);

        const txn = await ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, own.storeId, own.id);
          if (order.paymentMethod !== 'online' || order.status !== 'pending_payment' || !canTransition('payment', order.paymentStatus, 'pending')) {
            throw new AppError(409, 'invalid_transition', 'This order is not awaiting online payment.');
          }
          const [created] = await tx
            .insert(paymentTransactions)
            .values({ storeId: order.storeId, orderId: order.id, provider: providerName, amountPaise: order.totalPaise, currency: order.currency })
            .returning();
          return created!;
        });

        // Provider call outside the transaction (network I/O); the transaction row already exists.
        let result: Awaited<ReturnType<typeof provider.createPayment>>;
        try {
          result = await provider.createPayment({ transactionId: txn.id, orderNumber: own.orderNumber, amountPaise: txn.amountPaise, currency: txn.currency });
        } catch (err) {
          request.log.error({ err, transactionId: txn.id }, 'payment initiation failed');
          await ctx.db.update(paymentTransactions).set({ status: 'failed', failureCode: 'initiation_failed' }).where(eq(paymentTransactions.id, txn.id));
          throw new AppError(502, 'payment_error', 'Could not start the payment. Please try again.');
        }
        await ctx.db.transaction(async (tx) => {
          await tx.update(paymentTransactions).set({ status: 'pending', providerRef: result.providerRef }).where(eq(paymentTransactions.id, txn.id));
          const order = await lockOrder(tx, own.storeId, own.id);
          if (canTransition('payment', order.paymentStatus, 'pending')) {
            await transitionOrder(tx, order, 'payment', 'pending', actorOf(request));
          }
        });
        // The client completes payment with the provider. Payment is confirmed only by a verified webhook.
        return { payment: { transactionId: txn.id, provider: providerName, amountPaise: txn.amountPaise, currency: txn.currency, client: result.clientPayload } };
      },
    );

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/orders/:orderNumber/returns',
        summary: `Request a return or exchange within ${RETURN_WINDOW_DAYS} days of delivery`,
        tag,
        auth: 'customer',
        status: 201,
        params: orderParams,
        body: z.object({
          type: z.enum(['return', 'exchange']),
          reason: z.string().min(1).max(1000),
          items: z.array(z.object({ orderItemId: z.uuid(), quantity: z.number().int().min(1), exchangeVariantId: z.uuid().optional() })).min(1).max(50),
        }),
      },
      async (request, { params, body }) => {
        const own = await findOwnOrder(request, params.orderNumber);
        return ctx.db.transaction(async (tx) => {
          const order = await lockOrder(tx, own.storeId, own.id);
          if (order.fulfillmentStatus !== 'delivered') throw new AppError(409, 'invalid_transition', 'Returns can be requested after delivery.');
          const [delivered] = await tx
            .select({ at: orderEvents.createdAt })
            .from(orderEvents)
            .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.machine, 'fulfillment'), eq(orderEvents.toState, 'delivered')))
            .orderBy(desc(orderEvents.createdAt))
            .limit(1);
          const deliveredAt = delivered?.at ?? order.updatedAt;
          if (ctx.now().getTime() - deliveredAt.getTime() > RETURN_WINDOW_DAYS * 86_400_000) {
            throw new AppError(409, 'invalid_transition', 'The return window for this order has closed.');
          }
          const items = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, order.storeId), eq(orderItems.orderId, order.id)));
          const open = await tx
            .select({ items: returnRequests.items })
            .from(returnRequests)
            .where(and(eq(returnRequests.orderId, order.id), notInArray(returnRequests.status, ['rejected', 'cancelled'])));
          const alreadyRequested = new Map<string, number>();
          for (const r of open) for (const i of r.items) alreadyRequested.set(i.orderItemId, (alreadyRequested.get(i.orderItemId) ?? 0) + i.quantity);
          for (const line of body.items) {
            const item = items.find((i) => i.id === line.orderItemId);
            if (!item) throw notFound('Order item');
            if (line.quantity + (alreadyRequested.get(item.id) ?? 0) > item.quantity) {
              throw new AppError(422, 'invalid_request', `Return quantity exceeds what was ordered for ${item.productTitle}.`);
            }
            if (body.type === 'exchange' && !line.exchangeVariantId) throw new AppError(422, 'invalid_request', 'Choose a replacement for each exchanged item.');
          }
          const [request_] = await tx
            .insert(returnRequests)
            .values({ storeId: order.storeId, orderId: order.id, type: body.type, reason: body.reason, items: body.items })
            .returning();
          await addOrderEvent(tx, order, { machine: 'return', to: 'requested', actor: actorOf(request), note: `${body.type} requested`, isPublic: true });
          return { returnRequest: request_ };
        });
      },
    );

  };
}

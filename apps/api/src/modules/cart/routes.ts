import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { cartItems, carts, products, productVariants } from '../../db/schema.js';
import { AppError, notFound } from '../../lib/errors.js';
import { defineRoute } from '../../lib/route.js';
import { buildQuote, presentQuote } from '../checkout/quote.js';
import { optionalCustomer } from '../customers/routes.js';
import { type Cart, findCart, findOrCreateCart, MAX_LINE_QUANTITY } from './service.js';

const pincodeQuery = z.object({ pincode: z.string().regex(/^[1-9]\d{5}$/).optional() });

/**
 * Cart endpoints work for guests (X-Cart-Token header) and signed-in customers
 * (bearer token). Responses always carry a freshly computed server-side quote.
 */
export function cartRoutes(ctx: AppContext) {
  return async (app: FastifyInstance) => {
    const tag = 'Storefront: cart';

    const view = async (request: FastifyRequest, cart: Cart, pincode?: string, guestToken?: string) => {
      const quote = await buildQuote(ctx.db, {
        store: request.store,
        cart,
        customerId: request.customer?.id ?? null,
        ...(pincode ? { pincode } : {}),
        now: ctx.now(),
      });
      return { cart: { id: cart.id, couponCode: cart.couponCode, ...(guestToken ? { cartToken: guestToken } : {}) }, quote: presentQuote(quote) };
    };

    const requireCart = async (request: FastifyRequest) => {
      const cart = await findCart(ctx, request);
      if (!cart) throw notFound('Cart');
      return cart;
    };

    defineRoute(
      app,
      { method: 'POST', url: '/cart', summary: 'Get or create the current cart (new guest carts return cartToken once)', tag, auth: 'public' },
      async (request) => {
        await optionalCustomer(ctx, request);
        const { cart, guestToken } = await findOrCreateCart(ctx, request);
        return view(request, cart, undefined, guestToken);
      },
    );

    defineRoute(app, { method: 'GET', url: '/cart', summary: 'Current cart with server-calculated totals', tag, auth: 'public', query: pincodeQuery }, async (request, { query }) => {
      await optionalCustomer(ctx, request);
      return view(request, await requireCart(request), query.pincode);
    });

    defineRoute(
      app,
      {
        method: 'POST',
        url: '/cart/items',
        summary: 'Add a variant (quantities add up)',
        tag,
        auth: 'public',
        body: z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
      },
      async (request, { body }) => {
        await optionalCustomer(ctx, request);
        const storeId = request.store.id;
        const [variant] = await ctx.db
          .select({ id: productVariants.id })
          .from(productVariants)
          .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.storeId, storeId)))
          .where(and(eq(productVariants.storeId, storeId), eq(productVariants.id, body.variantId), eq(productVariants.status, 'active'), eq(products.status, 'published')));
        if (!variant) throw notFound('Product');
        const { cart, guestToken } = await findOrCreateCart(ctx, request);
        await ctx.db
          .insert(cartItems)
          .values({ storeId, cartId: cart.id, variantId: variant.id, quantity: body.quantity })
          .onConflictDoUpdate({
            target: [cartItems.cartId, cartItems.variantId],
            set: { quantity: sql`least(${cartItems.quantity} + excluded.quantity, ${MAX_LINE_QUANTITY})`, updatedAt: ctx.now() },
          });
        return view(request, cart, undefined, guestToken);
      },
    );

    defineRoute(
      app,
      {
        method: 'PATCH',
        url: '/cart/items/:itemId',
        summary: 'Change a line quantity',
        tag,
        auth: 'public',
        params: z.object({ itemId: z.uuid() }),
        body: z.object({ quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }),
      },
      async (request, { params, body }) => {
        await optionalCustomer(ctx, request);
        const cart = await requireCart(request);
        const updated = await ctx.db
          .update(cartItems)
          .set({ quantity: body.quantity })
          .where(and(eq(cartItems.id, params.itemId), eq(cartItems.cartId, cart.id), eq(cartItems.storeId, cart.storeId)))
          .returning({ id: cartItems.id });
        if (updated.length === 0) throw notFound('Cart item');
        return view(request, cart);
      },
    );

    defineRoute(
      app,
      { method: 'DELETE', url: '/cart/items/:itemId', summary: 'Remove a line', tag, auth: 'public', params: z.object({ itemId: z.uuid() }) },
      async (request, { params }) => {
        await optionalCustomer(ctx, request);
        const cart = await requireCart(request);
        const deleted = await ctx.db
          .delete(cartItems)
          .where(and(eq(cartItems.id, params.itemId), eq(cartItems.cartId, cart.id), eq(cartItems.storeId, cart.storeId)))
          .returning({ id: cartItems.id });
        if (deleted.length === 0) throw notFound('Cart item');
        return view(request, cart);
      },
    );

    defineRoute(
      app,
      {
        method: 'PUT',
        url: '/cart/coupon',
        summary: 'Apply a coupon code (validated on every quote)',
        tag,
        auth: 'public',
        body: z.object({ code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/) }),
      },
      async (request, { body }) => {
        await optionalCustomer(ctx, request);
        const cart = await requireCart(request);
        const [updated] = await ctx.db.update(carts).set({ couponCode: body.code.toUpperCase() }).where(eq(carts.id, cart.id)).returning();
        const result = await view(request, updated!);
        if (result.quote.coupon?.status === 'invalid') {
          await ctx.db.update(carts).set({ couponCode: null }).where(eq(carts.id, cart.id));
          throw new AppError(422, 'coupon_invalid', result.quote.coupon.message ?? 'This coupon is not valid.');
        }
        return result;
      },
    );

    defineRoute(app, { method: 'DELETE', url: '/cart/coupon', summary: 'Remove the coupon', tag, auth: 'public' }, async (request) => {
      await optionalCustomer(ctx, request);
      const cart = await requireCart(request);
      const [updated] = await ctx.db.update(carts).set({ couponCode: null }).where(eq(carts.id, cart.id)).returning();
      return view(request, updated!);
    });
  };
}

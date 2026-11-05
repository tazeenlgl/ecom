import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import type { DbOrTx, Tx } from '../../db/client.js';
import {
  cartItems,
  carts,
  collectionProducts,
  productMedia,
  products,
  productVariants,
  posStockLevels,
  variantPrices,
} from '../../db/schema.js';
import { newToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export type Cart = typeof carts.$inferSelect;
export const MAX_LINE_QUANTITY = 10;

export const CART_TOKEN_HEADER = 'x-cart-token';

/**
 * The caller's active cart: the signed-in customer's cart, or the guest cart
 * named by the X-Cart-Token header. Always scoped to the resolved store.
 */
export async function findCart(ctx: AppContext, request: FastifyRequest, db: DbOrTx = ctx.db): Promise<Cart | null> {
  const storeId = request.store.id;
  if (request.customer) {
    const [cart] = await db
      .select()
      .from(carts)
      .where(and(eq(carts.storeId, storeId), eq(carts.customerId, request.customer.id), eq(carts.status, 'active')));
    return cart ?? null;
  }
  const token = request.headers[CART_TOKEN_HEADER];
  if (typeof token !== 'string' || token.length > 200) return null;
  const [cart] = await db
    .select()
    .from(carts)
    .where(
      and(eq(carts.storeId, storeId), eq(carts.guestTokenHash, sha256(token)), eq(carts.status, 'active'), isNull(carts.customerId)),
    );
  return cart ?? null;
}

/** Returns the caller's cart, creating one if needed. A new guest cart comes with its token. */
export async function findOrCreateCart(ctx: AppContext, request: FastifyRequest): Promise<{ cart: Cart; guestToken?: string }> {
  const existing = await findCart(ctx, request);
  if (existing) return { cart: existing };
  const storeId = request.store.id;
  if (request.customer) {
    const [cart] = await ctx.db
      .insert(carts)
      .values({ storeId, customerId: request.customer.id })
      .onConflictDoNothing()
      .returning();
    if (cart) return { cart };
    const again = await findCart(ctx, request);
    if (!again) throw new AppError(409, 'conflict', 'Could not create a cart. Please retry.');
    return { cart: again };
  }
  const guestToken = newToken();
  const [cart] = await ctx.db.insert(carts).values({ storeId, guestTokenHash: sha256(guestToken) }).returning();
  return { cart: cart!, guestToken };
}

/**
 * Moves a guest cart's items into the customer's active cart after sign-in.
 * Quantities add up (capped); the guest cart is marked `merged`.
 */
export async function mergeGuestCart(tx: Tx, storeId: string, customerId: string, guestToken: string | undefined) {
  if (!guestToken) return;
  const [guest] = await tx
    .select()
    .from(carts)
    .where(and(eq(carts.storeId, storeId), eq(carts.guestTokenHash, sha256(guestToken)), eq(carts.status, 'active'), isNull(carts.customerId)))
    .for('update');
  if (!guest) return;

  const [target] = await tx
    .select()
    .from(carts)
    .where(and(eq(carts.storeId, storeId), eq(carts.customerId, customerId), eq(carts.status, 'active')))
    .for('update');
  if (!target) {
    // Adopt the guest cart as the customer's cart.
    await tx.update(carts).set({ customerId, guestTokenHash: null }).where(eq(carts.id, guest.id));
    return;
  }
  const items = await tx.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
  for (const item of items) {
    await tx
      .insert(cartItems)
      .values({ storeId, cartId: target.id, variantId: item.variantId, quantity: Math.min(item.quantity, MAX_LINE_QUANTITY) })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: { quantity: sql`least(${cartItems.quantity} + excluded.quantity, ${MAX_LINE_QUANTITY})` },
      });
  }
  if (!target.couponCode && guest.couponCode) {
    await tx.update(carts).set({ couponCode: guest.couponCode }).where(eq(carts.id, target.id));
  }
  await tx.update(carts).set({ status: 'merged', guestTokenHash: null }).where(eq(carts.id, guest.id));
}

export type CartLine = {
  itemId: string;
  variantId: string;
  productId: string;
  skuCode: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string;
  options: Record<string, string>;
  imageUrl: string | null;
  quantity: number;
  mrpPaise: number | null;
  unitPricePaise: number | null;
  taxRateBps: number;
  collectionIds: string[];
  /** Units the stock read model says are sellable; null when the POS has reported nothing. */
  availableQuantity: number | null;
  stockSyncedAt: Date | null;
  sellable: boolean;
};

/** Cart items joined with current catalogue, price and stock data. */
export async function loadCartLines(db: DbOrTx, storeId: string, cartId: string, posLocationRef: string | null): Promise<CartLine[]> {
  const rows = await db
    .select({
      itemId: cartItems.id,
      variantId: productVariants.id,
      productId: products.id,
      skuCode: productVariants.skuCode,
      productTitle: products.title,
      productSlug: products.slug,
      variantTitle: productVariants.title,
      options: productVariants.options,
      quantity: cartItems.quantity,
      mrpPaise: variantPrices.mrpPaise,
      unitPricePaise: variantPrices.pricePaise,
      taxRateBps: products.taxRateBps,
      productStatus: products.status,
      variantStatus: productVariants.status,
      availableQuantity: posStockLevels.available,
      stockSyncedAt: posStockLevels.syncedAt,
    })
    .from(cartItems)
    .innerJoin(productVariants, and(eq(productVariants.id, cartItems.variantId), eq(productVariants.storeId, storeId)))
    .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.storeId, storeId)))
    .leftJoin(variantPrices, eq(variantPrices.variantId, productVariants.id))
    .leftJoin(
      posStockLevels,
      and(eq(posStockLevels.skuCode, productVariants.skuCode), eq(posStockLevels.locationRef, posLocationRef ?? '')),
    )
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.storeId, storeId)))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.id));

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const memberships = productIds.length
    ? await db
        .select({ productId: collectionProducts.productId, collectionId: collectionProducts.collectionId })
        .from(collectionProducts)
        .where(and(eq(collectionProducts.storeId, storeId), inArray(collectionProducts.productId, productIds)))
    : [];
  const images = productIds.length
    ? await db
        .select({ productId: productMedia.productId, url: productMedia.url })
        .from(productMedia)
        .where(and(eq(productMedia.storeId, storeId), inArray(productMedia.productId, productIds), eq(productMedia.kind, 'image')))
        .orderBy(asc(productMedia.position))
    : [];

  return rows.map(({ productStatus, variantStatus, ...r }) => ({
    ...r,
    collectionIds: memberships.filter((m) => m.productId === r.productId).map((m) => m.collectionId),
    imageUrl: images.find((i) => i.productId === r.productId)?.url ?? null,
    sellable: productStatus === 'published' && variantStatus === 'active' && r.unitPricePaise !== null,
  }));
}

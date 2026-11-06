import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { orderEvents, orders, productVariants, products } from '../../db/schema.js';

export const RETURN_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

type OrderRow = typeof orders.$inferSelect;
type ReturnItems = { orderItemId: string; quantity: number }[];

/** When the order was delivered (the latest `delivered` fulfilment event; falls back to the last update for old data). */
export async function loadDeliveredAt(db: DbOrTx, order: Pick<OrderRow, 'id' | 'updatedAt' | 'fulfillmentStatus'>): Promise<Date | null> {
  if (order.fulfillmentStatus !== 'delivered') return null;
  const [delivered] = await db
    .select({ at: orderEvents.createdAt })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.machine, 'fulfillment'), eq(orderEvents.toState, 'delivered')))
    .orderBy(desc(orderEvents.createdAt))
    .limit(1);
  return delivered?.at ?? order.updatedAt;
}

export const returnWindowEndsAt = (deliveredAt: Date): Date => new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS);

/** Quantity already asked for per order line by requests that are still alive (not rejected or cancelled). */
export function requestedQuantities(open: { items: ReturnItems }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of open) for (const i of r.items) out.set(i.orderItemId, (out.get(i.orderItemId) ?? 0) + i.quantity);
  return out;
}

/**
 * Whether the customer can start a return or exchange right now: delivered, inside the window, and at least one
 * line still has quantity that has not been asked for. The returns endpoint enforces the same conditions.
 */
export function customerCanReturn(input: { deliveredAt: Date | null; now: Date; lines: { id: string; quantity: number }[]; open: { items: ReturnItems }[] }): boolean {
  if (!input.deliveredAt) return false;
  if (input.now.getTime() > returnWindowEndsAt(input.deliveredAt).getTime()) return false;
  const asked = requestedQuantities(input.open);
  return input.lines.some((l) => l.quantity > (asked.get(l.id) ?? 0));
}

export type ReplacementVariant = { id: string; title: string; options: Record<string, string> };

/**
 * Variants a customer may exchange an ordered line for: another ACTIVE variant of the SAME product, in the same
 * store, and only while that product is published. This is both what the storefront offers and what the returns
 * endpoint validates against, so the two can never disagree.
 */
export async function eligibleReplacementVariants(db: DbOrTx, order: Pick<OrderRow, 'storeId'>, line: { productId: string; variantId: string }): Promise<ReplacementVariant[]> {
  const rows = await db
    .select({ id: productVariants.id, title: productVariants.title, options: productVariants.options, position: productVariants.position })
    .from(productVariants)
    .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.storeId, productVariants.storeId)))
    .where(
      and(
        eq(productVariants.storeId, order.storeId),
        eq(productVariants.productId, line.productId),
        eq(productVariants.status, 'active'),
        eq(products.status, 'published'),
      ),
    )
    .orderBy(productVariants.position);
  return rows.filter((r) => r.id !== line.variantId).map(({ id, title, options }) => ({ id, title, options: options as Record<string, string> }));
}

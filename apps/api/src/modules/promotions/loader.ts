import { and, count, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { coupons, promotionRedemptions, promotions } from '../../db/schema.js';
import type { EnginePromotion, PromotionKind } from './engine.js';

export type CouponStatus = { code: string; status: 'applied' | 'invalid' | 'not_applicable'; message?: string };

type PromotionRow = typeof promotions.$inferSelect;

const toEngine = (p: PromotionRow, couponCode?: string): EnginePromotion => ({
  id: p.id,
  name: p.name,
  kind: p.kind as PromotionKind,
  config: p.config,
  eligibility: p.eligibility,
  minSubtotalPaise: p.minSubtotalPaise,
  priority: p.priority,
  stackable: p.stackable,
  ...(couponCode ? { couponCode } : {}),
});

async function redemptionCount(db: DbOrTx, promotionId: string, customerId?: string | null, couponId?: string) {
  const [row] = await db
    .select({ n: count() })
    .from(promotionRedemptions)
    .where(
      and(
        eq(promotionRedemptions.promotionId, promotionId),
        isNull(promotionRedemptions.voidedAt),
        customerId ? eq(promotionRedemptions.customerId, customerId) : undefined,
        couponId ? eq(promotionRedemptions.couponId, couponId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Whether a promotion (and coupon) is still under its usage limits for this customer. */
export async function withinUsageLimits(
  db: DbOrTx,
  promo: Pick<PromotionRow, 'id' | 'usageLimit' | 'perCustomerLimit'>,
  customerId: string | null,
  coupon?: { id: string; usageLimit: number | null },
): Promise<boolean> {
  if (promo.usageLimit !== null && (await redemptionCount(db, promo.id)) >= promo.usageLimit) return false;
  if (promo.perCustomerLimit !== null && customerId && (await redemptionCount(db, promo.id, customerId)) >= promo.perCustomerLimit) {
    return false;
  }
  if (coupon?.usageLimit != null && (await redemptionCount(db, promo.id, null, coupon.id)) >= coupon.usageLimit) return false;
  return true;
}

/**
 * Promotions that may apply to a cart right now: automatic ones plus the one
 * unlocked by the cart's coupon, each active, in its window and under its limits.
 */
export async function loadCandidatePromotions(
  db: DbOrTx,
  input: { storeId: string; now: Date; couponCode: string | null; customerId: string | null },
): Promise<{ promotions: EnginePromotion[]; coupon: CouponStatus | null; couponIds: Record<string, string> }> {
  const inWindow = and(
    eq(promotions.storeId, input.storeId),
    eq(promotions.status, 'active'),
    or(isNull(promotions.startsAt), lte(promotions.startsAt, input.now)),
    or(isNull(promotions.endsAt), gt(promotions.endsAt, input.now)),
  );

  const automatic = await db.select().from(promotions).where(and(inWindow, eq(promotions.requiresCoupon, false)));
  const result: EnginePromotion[] = [];
  for (const p of automatic) {
    if (await withinUsageLimits(db, p, input.customerId)) result.push(toEngine(p));
  }

  let coupon: CouponStatus | null = null;
  const couponIds: Record<string, string> = {};
  if (input.couponCode) {
    const code = input.couponCode;
    const [row] = await db
      .select({ coupon: coupons, promotion: promotions })
      .from(coupons)
      .innerJoin(promotions, eq(promotions.id, coupons.promotionId))
      .where(and(eq(coupons.storeId, input.storeId), eq(coupons.code, code), eq(coupons.isActive, true), inWindow));
    if (!row || !row.promotion.requiresCoupon) {
      coupon = { code, status: 'invalid', message: 'This coupon is not valid.' };
    } else if (!(await withinUsageLimits(db, row.promotion, input.customerId, row.coupon))) {
      coupon = { code, status: 'invalid', message: 'This coupon has reached its usage limit.' };
    } else {
      result.push(toEngine(row.promotion, code));
      couponIds[row.promotion.id] = row.coupon.id;
      coupon = { code, status: 'applied' };
    }
  }
  return { promotions: result, coupon, couponIds };
}

/** Locks applied promotions (in id order, to avoid deadlocks) and re-checks limits at order time. */
export async function lockAndRecheckPromotions(
  db: DbOrTx,
  promotionIds: string[],
  customerId: string,
  couponIds: Record<string, string>,
): Promise<boolean> {
  if (promotionIds.length === 0) return true;
  const rows = await db
    .select()
    .from(promotions)
    .where(inArray(promotions.id, [...promotionIds].sort()))
    .orderBy(promotions.id)
    .for('update');
  for (const p of rows) {
    const couponId = couponIds[p.id];
    const coupon = couponId ? (await db.select().from(coupons).where(eq(coupons.id, couponId)))[0] : undefined;
    if (!(await withinUsageLimits(db, p, customerId, coupon))) return false;
  }
  return true;
}

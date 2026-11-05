import { z } from 'zod';

/**
 * Pure promotion evaluation. No I/O: the caller loads candidate promotions
 * (active, in their validity window, under usage limits) and the cart lines
 * with server-side prices. Rules (also in docs/ORDERS_AND_FULFILLMENT.md#promotions):
 *
 * 1. Promotions run in priority order (higher first; ties by id for determinism).
 * 2. A non-stackable promotion applies only if nothing has applied yet, and once
 *    it applies nothing else does. Stackable promotions combine with each other.
 * 3. Each promotion discounts what is left of a line after earlier promotions,
 *    so a line never goes below zero.
 * 4. Cart-value thresholds compare against the eligible lines' pre-discount subtotal.
 * 5. A promotion that would discount nothing is not reported as applied.
 */

export const promotionConfigSchemas = {
  percentage: z.object({ percentBps: z.number().int().min(1).max(10000), maxDiscountPaise: z.number().int().positive().optional() }).strict(),
  fixed_amount: z.object({ amountPaise: z.number().int().positive() }).strict(),
  buy_x_get_y: z
    .object({
      buyQuantity: z.number().int().min(1).max(100),
      getQuantity: z.number().int().min(1).max(100),
      getDiscountBps: z.number().int().min(1).max(10000),
    })
    .strict(),
  free_shipping: z.object({}).strict(),
} as const;

export type PromotionKind = keyof typeof promotionConfigSchemas;

export type EngineLine = {
  key: string;
  productId: string;
  collectionIds: string[];
  quantity: number;
  unitPricePaise: number;
};

export type EnginePromotion = {
  id: string;
  name: string;
  kind: PromotionKind;
  config: Record<string, number | undefined>;
  eligibility: { productIds?: string[]; collectionIds?: string[] };
  minSubtotalPaise: number;
  priority: number;
  stackable: boolean;
  couponCode?: string;
};

export type AppliedPromotion = {
  promotionId: string;
  name: string;
  kind: PromotionKind;
  couponCode?: string;
  discountPaise: number;
  shippingDiscountPaise: number;
};

export type EngineResult = {
  lineDiscounts: Record<string, number>;
  shippingDiscountPaise: number;
  applied: AppliedPromotion[];
};

export function isEligible(line: EngineLine, eligibility: EnginePromotion['eligibility']): boolean {
  const products = eligibility.productIds ?? [];
  const collections = eligibility.collectionIds ?? [];
  if (products.length === 0 && collections.length === 0) return true;
  return products.includes(line.productId) || line.collectionIds.some((c) => collections.includes(c));
}

/**
 * Splits `total` across `caps` in proportion to them, never exceeding a cap,
 * with integer results that sum exactly to min(total, sum(caps)).
 */
export function allocate(total: number, caps: number[]): number[] {
  const capSum = caps.reduce((a, b) => a + b, 0);
  const amount = Math.min(total, capSum);
  if (amount <= 0 || capSum === 0) return caps.map(() => 0);
  const exact = caps.map((c) => (amount * c) / capSum);
  const result = exact.map(Math.floor);
  let remainder = amount - result.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder === 0) break;
    if (result[i]! < caps[i]!) {
      result[i]! += 1;
      remainder -= 1;
    }
  }
  return result;
}

export function evaluatePromotions(lines: EngineLine[], promotions: EnginePromotion[], shippingPaise: number): EngineResult {
  const lineDiscounts: Record<string, number> = Object.fromEntries(lines.map((l) => [l.key, 0]));
  let shippingDiscountPaise = 0;
  const applied: AppliedPromotion[] = [];
  let exclusiveApplied = false;

  const ordered = [...promotions].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  for (const promo of ordered) {
    if (exclusiveApplied) break;
    if (!promo.stackable && applied.length > 0) continue;

    const eligible = lines.filter((l) => isEligible(l, promo.eligibility));
    const eligibleSubtotal = eligible.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);
    if (eligible.length === 0 || eligibleSubtotal < promo.minSubtotalPaise) continue;

    const remaining = eligible.map((l) => l.unitPricePaise * l.quantity - lineDiscounts[l.key]!);
    const remainingTotal = remaining.reduce((a, b) => a + b, 0);
    let itemDiscounts = eligible.map(() => 0);
    let shippingDiscount = 0;

    switch (promo.kind) {
      case 'percentage': {
        const { percentBps = 0, maxDiscountPaise } = promo.config;
        let total = Math.floor((remainingTotal * percentBps) / 10000);
        if (maxDiscountPaise !== undefined) total = Math.min(total, maxDiscountPaise);
        itemDiscounts = allocate(total, remaining);
        break;
      }
      case 'fixed_amount':
        itemDiscounts = allocate(promo.config.amountPaise ?? 0, remaining);
        break;
      case 'buy_x_get_y': {
        const { buyQuantity = 1, getQuantity = 1, getDiscountBps = 10000 } = promo.config;
        // Expand to units, most expensive first; the cheapest units in each group are discounted.
        const units = eligible
          .flatMap((l, idx) => Array.from({ length: l.quantity }, () => ({ idx, price: l.unitPricePaise })))
          .sort((a, b) => b.price - a.price);
        const groups = Math.floor(units.length / (buyQuantity + getQuantity));
        const discounted = units.slice(units.length - groups * getQuantity);
        for (const unit of discounted) {
          const off = Math.floor((unit.price * getDiscountBps) / 10000);
          itemDiscounts[unit.idx] = Math.min(itemDiscounts[unit.idx]! + off, remaining[unit.idx]!);
        }
        break;
      }
      case 'free_shipping':
        shippingDiscount = Math.max(0, shippingPaise - shippingDiscountPaise);
        break;
    }

    const itemTotal = itemDiscounts.reduce((a, b) => a + b, 0);
    if (itemTotal === 0 && shippingDiscount === 0) continue;

    eligible.forEach((l, i) => {
      lineDiscounts[l.key]! += itemDiscounts[i]!;
    });
    shippingDiscountPaise += shippingDiscount;
    applied.push({
      promotionId: promo.id,
      name: promo.name,
      kind: promo.kind,
      ...(promo.couponCode ? { couponCode: promo.couponCode } : {}),
      discountPaise: itemTotal,
      shippingDiscountPaise: shippingDiscount,
    });
    if (!promo.stackable) exclusiveApplied = true;
  }

  return { lineDiscounts, shippingDiscountPaise, applied };
}

/** GST included in a tax-inclusive amount: amount × rate / (1 + rate), rounded half-up to the paisa. */
export const includedTax = (amountPaise: number, rateBps: number): number =>
  rateBps <= 0 ? 0 : Math.round((amountPaise * rateBps) / (10000 + rateBps));

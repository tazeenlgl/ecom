import type { DbOrTx } from '../../db/client.js';
import type { StoreConfig } from '../../db/schema.js';
import { type CartLine, loadCartLines } from '../cart/service.js';
import { evaluatePromotions, includedTax, type AppliedPromotion } from '../promotions/engine.js';
import { type CouponStatus, loadCandidatePromotions } from '../promotions/loader.js';
import { findZone, shippingCharge } from '../shipping/zones.js';

export type QuoteIssue = {
  code: 'empty_cart' | 'unavailable' | 'insufficient_stock' | 'stock_unknown' | 'not_serviceable' | 'cod_unavailable';
  message: string;
  variantId?: string;
};

export type QuoteLine = CartLine & { discountPaise: number; lineTotalPaise: number; taxPaise: number };

export type Quote = {
  lines: QuoteLine[];
  issues: QuoteIssue[];
  coupon: CouponStatus | null;
  couponIds: Record<string, string>;
  appliedPromotions: AppliedPromotion[];
  shipping: { pincode: string; serviceable: boolean; zoneName?: string; codAvailable: boolean; estimatedDays?: [number, number] } | null;
  subtotalPaise: number;
  itemDiscountPaise: number;
  shippingPaise: number;
  shippingDiscountPaise: number;
  discountPaise: number;
  codFeePaise: number;
  taxPaise: number;
  totalPaise: number;
};

export type QuoteInput = {
  store: { id: string; config: StoreConfig; posLocationRef: string | null };
  cart: { id: string; couponCode: string | null };
  customerId: string | null;
  pincode?: string;
  paymentMethod?: 'online' | 'cod';
  now: Date;
};

/**
 * Prices a cart entirely on the server from current catalogue prices, stock
 * read model, promotions and shipping zones. Client-sent prices or totals are
 * never inputs. Used for the cart view, the checkout preview and order creation.
 */
export async function buildQuote(db: DbOrTx, input: QuoteInput): Promise<Quote> {
  const lines = await loadCartLines(db, input.store.id, input.cart.id, input.store.posLocationRef);
  const issues: QuoteIssue[] = [];
  if (lines.length === 0) issues.push({ code: 'empty_cart', message: 'Your cart is empty.' });

  for (const line of lines) {
    if (!line.sellable) {
      issues.push({ code: 'unavailable', variantId: line.variantId, message: `${line.productTitle} is no longer available.` });
    } else if (line.availableQuantity === null) {
      issues.push({ code: 'stock_unknown', variantId: line.variantId, message: `Stock for ${line.productTitle} could not be confirmed.` });
    } else if (line.availableQuantity < line.quantity) {
      issues.push({
        code: 'insufficient_stock',
        variantId: line.variantId,
        message: `Only ${Math.max(0, line.availableQuantity)} of ${line.productTitle} available.`,
      });
    }
  }

  // Only sellable lines are priced.
  const priced = lines.filter((l) => l.sellable);
  const subtotalPaise = priced.reduce((s, l) => s + l.unitPricePaise! * l.quantity, 0);

  let shipping: Quote['shipping'] = null;
  let shippingPaise = 0;
  let codFeeIfCod = 0;
  if (input.pincode) {
    const zone = await findZone(db, input.store.id, input.pincode);
    if (!zone) {
      shipping = { pincode: input.pincode, serviceable: false, codAvailable: false };
      issues.push({ code: 'not_serviceable', message: 'We do not deliver to this PIN code yet.' });
    } else {
      shippingPaise = shippingCharge(zone, subtotalPaise);
      codFeeIfCod = zone.codFeePaise;
      shipping = {
        pincode: input.pincode,
        serviceable: true,
        zoneName: zone.name,
        codAvailable: zone.codAvailable && input.store.config.codEnabled === true,
        ...(zone.estimatedDaysMin !== null && zone.estimatedDaysMax !== null
          ? { estimatedDays: [zone.estimatedDaysMin, zone.estimatedDaysMax] as [number, number] }
          : {}),
      };
    }
  }

  const { promotions, coupon, couponIds } = await loadCandidatePromotions(db, {
    storeId: input.store.id,
    now: input.now,
    couponCode: input.cart.couponCode,
    customerId: input.customerId,
  });
  const engine = evaluatePromotions(
    priced.map((l) => ({
      key: l.variantId,
      productId: l.productId,
      collectionIds: l.collectionIds,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise!,
    })),
    promotions,
    shippingPaise,
  );
  const couponState: CouponStatus | null =
    coupon?.status === 'applied' && !engine.applied.some((a) => a.couponCode === coupon.code)
      ? { code: coupon.code, status: 'not_applicable', message: 'This coupon does not apply to the items in your cart.' }
      : coupon;

  const quoteLines: QuoteLine[] = lines.map((l) => {
    const gross = l.sellable ? l.unitPricePaise! * l.quantity : 0;
    const discountPaise = l.sellable ? (engine.lineDiscounts[l.variantId] ?? 0) : 0;
    const lineTotalPaise = gross - discountPaise;
    return { ...l, discountPaise, lineTotalPaise, taxPaise: includedTax(lineTotalPaise, l.taxRateBps) };
  });

  const itemDiscountPaise = Object.values(engine.lineDiscounts).reduce((a, b) => a + b, 0);
  const merchandise = subtotalPaise - itemDiscountPaise;
  const totalBeforeCod = merchandise + shippingPaise - engine.shippingDiscountPaise;

  let codFeePaise = 0;
  if (input.paymentMethod === 'cod') {
    const maxCod = input.store.config.codMaxOrderPaise;
    if (!shipping?.codAvailable || (maxCod !== undefined && totalBeforeCod + codFeeIfCod > maxCod)) {
      issues.push({ code: 'cod_unavailable', message: 'Cash on delivery is not available for this order.' });
    } else {
      codFeePaise = codFeeIfCod;
    }
  }

  return {
    lines: quoteLines,
    issues,
    coupon: couponState,
    couponIds,
    appliedPromotions: engine.applied,
    shipping,
    subtotalPaise,
    itemDiscountPaise,
    shippingPaise,
    shippingDiscountPaise: engine.shippingDiscountPaise,
    discountPaise: itemDiscountPaise + engine.shippingDiscountPaise,
    codFeePaise,
    // GST is included in item prices; shipping GST is not modelled yet (docs/KNOWN_ISSUES.md).
    taxPaise: quoteLines.reduce((s, l) => s + l.taxPaise, 0),
    totalPaise: totalBeforeCod + codFeePaise,
  };
}

/** The customer-facing view of a quote (no internal ids such as coupon ids). */
export function presentQuote(q: Quote) {
  const { couponIds: _couponIds, ...rest } = q;
  return {
    ...rest,
    lines: q.lines.map((l) => ({
      itemId: l.itemId,
      variantId: l.variantId,
      productId: l.productId,
      productSlug: l.productSlug,
      productTitle: l.productTitle,
      variantTitle: l.variantTitle,
      skuCode: l.skuCode,
      options: l.options,
      imageUrl: l.imageUrl,
      quantity: l.quantity,
      mrpPaise: l.mrpPaise,
      unitPricePaise: l.unitPricePaise,
      discountPaise: l.discountPaise,
      lineTotalPaise: l.lineTotalPaise,
      sellable: l.sellable,
      availableQuantity: l.availableQuantity,
    })),
  };
}

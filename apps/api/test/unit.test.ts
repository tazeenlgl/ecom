import { describe, expect, it } from 'vitest';
import { normalizeIndianMobile } from '../src/lib/india.js';
import { hasPermission } from '../src/modules/iam/permissions.js';
import { maskRecipient } from '../src/modules/notifications/sender.js';
import { canTransition } from '../src/modules/orders/state-machines.js';
import { allocate, type EngineLine, type EnginePromotion, evaluatePromotions, includedTax } from '../src/modules/promotions/engine.js';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['098765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('normalises %j', (input, expected) => expect(normalizeIndianMobile(input)).toBe(expected));

  it.each(['5876543210', '98765', '+1 415 555 0100', '98765432100', 'abc9876543210', ''])('rejects %j', (input) =>
    expect(normalizeIndianMobile(input)).toBeNull(),
  );
});

describe('permissions', () => {
  const store = 'store-a';
  it('store grants apply only to that store and never to platform permissions', () => {
    const grants = [{ role: 'store_manager', storeId: store }];
    expect(hasPermission(grants, 'orders.manage', store)).toBe(true);
    expect(hasPermission(grants, 'orders.manage', 'store-b')).toBe(false);
    expect(hasPermission(grants, 'orders.manage', null)).toBe(false);
    expect(hasPermission(grants, 'platform.domains.manage', store)).toBe(false);
  });
  it('platform grants apply everywhere', () => {
    const grants = [{ role: 'platform_owner', storeId: null }];
    expect(hasPermission(grants, 'orders.manage', 'any')).toBe(true);
    expect(hasPermission(grants, 'platform.admins.manage', null)).toBe(true);
  });
  it('unknown roles grant nothing', () => {
    expect(hasPermission([{ role: 'root', storeId: null }], 'orders.read', 'x')).toBe(false);
  });
});

describe('state machines', () => {
  it('allows only listed transitions', () => {
    expect(canTransition('order', 'pending_payment', 'confirmed')).toBe(true);
    expect(canTransition('order', 'completed', 'cancelled')).toBe(false);
    expect(canTransition('order', 'cancelled', 'confirmed')).toBe(false);
    expect(canTransition('payment', 'paid', 'failed')).toBe(false);
    expect(canTransition('transaction', 'failed', 'succeeded')).toBe(true);
    expect(canTransition('transaction', 'succeeded', 'failed')).toBe(false);
    expect(canTransition('fulfillment', 'shipped', 'cancelled')).toBe(false);
    expect(canTransition('pos_sync', 'synced', 'pending')).toBe(false);
  });
});

describe('promotion engine', () => {
  const line = (key: string, unitPricePaise: number, quantity = 1, extra: Partial<EngineLine> = {}): EngineLine => ({
    key,
    productId: `p-${key}`,
    collectionIds: [],
    quantity,
    unitPricePaise,
    ...extra,
  });
  const promo = (p: Partial<EnginePromotion> & Pick<EnginePromotion, 'id' | 'kind'>): EnginePromotion => ({
    name: p.id,
    config: {},
    eligibility: {},
    minSubtotalPaise: 0,
    priority: 0,
    stackable: false,
    ...p,
  });

  it('allocate splits exactly and respects caps', () => {
    expect(allocate(100, [50, 50, 50])).toEqual([34, 33, 33]);
    expect(allocate(1000, [100, 200])).toEqual([100, 200]);
    expect(allocate(0, [10])).toEqual([0]);
  });

  it('applies a capped percentage discount', () => {
    const r = evaluatePromotions([line('a', 100_000), line('b', 50_000)], [promo({ id: 'p', kind: 'percentage', config: { percentBps: 1000, maxDiscountPaise: 10_000 } })], 0);
    expect(r.applied[0]!.discountPaise).toBe(10_000);
    expect(r.lineDiscounts.a! + r.lineDiscounts.b!).toBe(10_000);
  });

  it('respects cart-value thresholds and eligibility', () => {
    const lines = [line('a', 40_000, 1, { collectionIds: ['sale'] }), line('b', 70_000)];
    const p = promo({ id: 'p', kind: 'fixed_amount', config: { amountPaise: 5_000 }, eligibility: { collectionIds: ['sale'] }, minSubtotalPaise: 50_000 });
    expect(evaluatePromotions(lines, [p], 0).applied).toHaveLength(0); // eligible subtotal 40k < 50k
    const r = evaluatePromotions(lines, [{ ...p, minSubtotalPaise: 30_000 }], 0);
    expect(r.lineDiscounts).toEqual({ a: 5_000, b: 0 });
  });

  it('buy 2 get 1 free discounts the cheapest unit', () => {
    const r = evaluatePromotions([line('a', 1000, 2), line('b', 600)], [promo({ id: 'p', kind: 'buy_x_get_y', config: { buyQuantity: 2, getQuantity: 1, getDiscountBps: 10000 } })], 0);
    expect(r.lineDiscounts).toEqual({ a: 0, b: 600 });
  });

  it('a non-stackable higher-priority promotion excludes the rest', () => {
    const r = evaluatePromotions(
      [line('a', 10_000)],
      [promo({ id: 'low', kind: 'percentage', config: { percentBps: 5000 }, stackable: true }), promo({ id: 'high', kind: 'fixed_amount', config: { amountPaise: 100 }, priority: 10 })],
      0,
    );
    expect(r.applied.map((a) => a.promotionId)).toEqual(['high']);
  });

  it('stackable promotions combine on the remaining amount and never go negative', () => {
    const r = evaluatePromotions(
      [line('a', 10_000)],
      [
        promo({ id: 'p1', kind: 'percentage', config: { percentBps: 5000 }, stackable: true, priority: 2 }),
        promo({ id: 'p2', kind: 'fixed_amount', config: { amountPaise: 8_000 }, stackable: true, priority: 1 }),
        promo({ id: 'ship', kind: 'free_shipping', stackable: true }),
      ],
      4_900,
    );
    expect(r.lineDiscounts.a).toBe(10_000);
    expect(r.shippingDiscountPaise).toBe(4_900);
    expect(r.applied.map((a) => a.promotionId)).toEqual(['p1', 'p2', 'ship']);
  });

  it('computes GST included in a price', () => {
    expect(includedTax(105_00, 500)).toBe(5_00);
    expect(includedTax(1000, 0)).toBe(0);
  });
});

describe('maskRecipient', () => {
  it('hides most of a phone number or email', () => {
    expect(maskRecipient('+919876543210')).toBe('*********3210');
    expect(maskRecipient('someone@example.com')).toBe('s***@example.com');
  });
});

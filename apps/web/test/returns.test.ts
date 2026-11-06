import { describe, expect, it } from 'vitest';
import { buildReturnRequest } from '@/lib/returns';

const base = { reason: 'Too small', quantities: { a: 1, b: 0, c: 2 }, replacements: { a: 'va', b: 'vb', c: 'vc' } };

describe('buildReturnRequest', () => {
  it('builds a plain return from the lines with a quantity and never sends a replacement', () => {
    const r = buildReturnRequest({ ...base, type: 'return' });
    expect(r).toEqual({ ok: true, body: { type: 'return', reason: 'Too small', items: [{ orderItemId: 'a', quantity: 1 }, { orderItemId: 'c', quantity: 2 }] } });
  });

  it('builds an exchange with the replacement chosen for each selected line only', () => {
    const r = buildReturnRequest({ ...base, type: 'exchange' });
    expect(r).toEqual({
      ok: true,
      body: { type: 'exchange', reason: 'Too small', items: [{ orderItemId: 'a', quantity: 1, exchangeVariantId: 'va' }, { orderItemId: 'c', quantity: 2, exchangeVariantId: 'vc' }] },
    });
  });

  it('refuses an exchange when a selected line has no replacement, and names the line', () => {
    const r = buildReturnRequest({ ...base, type: 'exchange', replacements: { a: 'va' } });
    expect(r).toMatchObject({ ok: false, field: 'replacement', orderItemId: 'c' });
  });

  it('ignores a replacement picked for a line that is not part of the request', () => {
    const r = buildReturnRequest({ type: 'exchange', reason: 'x', quantities: { a: 1 }, replacements: { a: 'va', z: 'vz' } });
    expect(r.ok && r.body.items).toEqual([{ orderItemId: 'a', quantity: 1, exchangeVariantId: 'va' }]);
  });

  it('refuses a request with no items', () => {
    expect(buildReturnRequest({ ...base, type: 'return', quantities: { a: 0 } })).toMatchObject({ ok: false, field: 'items' });
    expect(buildReturnRequest({ ...base, type: 'return', quantities: {} })).toMatchObject({ ok: false, field: 'items' });
  });

  it('refuses a missing or blank reason, and trims it', () => {
    expect(buildReturnRequest({ ...base, type: 'return', reason: '   ' })).toMatchObject({ ok: false, field: 'reason' });
    const r = buildReturnRequest({ ...base, type: 'return', reason: '  Wrong colour  ' });
    expect(r.ok && r.body.reason).toBe('Wrong colour');
  });

  it('drops non-integer and negative quantities', () => {
    const r = buildReturnRequest({ type: 'return', reason: 'x', quantities: { a: 1.5, b: -1, c: 2 }, replacements: {} });
    expect(r.ok && r.body.items).toEqual([{ orderItemId: 'c', quantity: 2 }]);
  });
});

export type ReturnDraft = {
  type: 'return' | 'exchange';
  reason: string;
  /** Quantity chosen per order line id (0 or missing = not part of the request). */
  quantities: Record<string, number>;
  /** Replacement variant chosen per order line id (exchange only). */
  replacements: Record<string, string>;
};

export type ReturnRequestBody = {
  type: 'return' | 'exchange';
  reason: string;
  items: { orderItemId: string; quantity: number; exchangeVariantId?: string }[];
};

export type BuildResult = { ok: true; body: ReturnRequestBody } | { ok: false; error: string; field: 'items' | 'reason' | 'replacement'; orderItemId?: string };

/**
 * Turns the form state into the API request, or says what is missing. An exchange needs a replacement for every
 * selected line; a plain return never sends one. The API validates the replacement again (same product, active,
 * published, same store), so this only prevents obviously incomplete requests.
 */
export function buildReturnRequest(draft: ReturnDraft): BuildResult {
  const items = Object.entries(draft.quantities)
    .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  if (items.length === 0) return { ok: false, field: 'items', error: 'Choose at least one item and a quantity.' };
  const reason = draft.reason.trim();
  if (!reason) return { ok: false, field: 'reason', error: 'Tell us why you are returning or exchanging.' };

  if (draft.type === 'return') return { ok: true, body: { type: 'return', reason, items } };

  const withReplacement = [];
  for (const item of items) {
    const exchangeVariantId = draft.replacements[item.orderItemId];
    if (!exchangeVariantId) return { ok: false, field: 'replacement', orderItemId: item.orderItemId, error: 'Choose a replacement for each item you want to exchange.' };
    withReplacement.push({ ...item, exchangeVariantId });
  }
  return { ok: true, body: { type: 'exchange', reason, items: withReplacement } };
}

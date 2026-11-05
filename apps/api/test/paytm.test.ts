import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, orders, paymentGatewayConfigs } from '../src/db/schema.js';
import { jobHandlers } from '../src/modules/jobs/handlers.js';
import { runDueJobs } from '../src/modules/jobs/queue.js';
import { generateSignature, paramsToString, verifySignature } from '../src/modules/payments/paytm/checksum.js';
import { paiseToRupees, rupeesToPaise } from '../src/modules/payments/paytm/provider.js';
import { adminToken, bearer, customerToken, seedStore, setupTestApp, type TestContext } from './helpers.js';
import { InMemoryPosGateway } from './support/in-memory-pos.js';

const MID = 'TESTMID00000000001';
const KEY = 'abcdEFGH1234&_!x';

describe('Paytm checksum', () => {
  it('verifies its own signatures and rejects tampering or the wrong key', () => {
    const body = JSON.stringify({ mid: MID, orderId: 'o1' });
    const sig = generateSignature(body, KEY);
    expect(verifySignature(body, KEY, sig)).toBe(true);
    expect(verifySignature(body.replace('o1', 'o2'), KEY, sig)).toBe(false);
    expect(verifySignature(body, 'zzzzEFGH1234&_!x', sig)).toBe(false);
    expect(verifySignature(body, KEY, 'not-base64!')).toBe(false);
  });

  it('builds the form string sorted by key with "null" as empty', () => {
    expect(paramsToString({ STATUS: 'TXN_SUCCESS', MID: 'M', BANKNAME: 'null' })).toBe('|M|TXN_SUCCESS');
  });

  it('converts between paise and rupee strings exactly', () => {
    expect(paiseToRupees(450_005)).toBe('4500.05');
    expect(paiseToRupees(99)).toBe('0.99');
    expect(rupeesToPaise('4500.05')).toBe(450_005);
    expect(rupeesToPaise('12.5')).toBe(1250);
    expect(rupeesToPaise('1e3')).toBeNull();
  });
});

// A stand-in for Paytm's staging API: records requests and answers like the documented responses.
const calls: { url: string; body: Record<string, unknown> }[] = [];
const paytmState = new Map<string, { status: string; amount: string }>();
const fakePaytm = (async (url: string | URL, init?: RequestInit) => {
  const parsed = JSON.parse(String(init?.body)) as { body: Record<string, unknown>; head: { signature: string } };
  calls.push({ url: String(url), body: parsed.body });
  if (!verifySignature(JSON.stringify(parsed.body), KEY, parsed.head.signature)) {
    return Response.json({ body: { resultInfo: { resultStatus: 'F', resultCode: '2005', resultMsg: 'Checksum invalid' } } });
  }
  const path = new URL(String(url)).pathname;
  if (path === '/theia/api/v1/initiateTransaction') {
    const { orderId, txnAmount } = parsed.body as { orderId: string; txnAmount: { value: string } };
    paytmState.set(orderId, { status: 'PENDING', amount: txnAmount.value });
    return Response.json({ body: { resultInfo: { resultStatus: 'S', resultCode: '0000', resultMsg: 'Success' }, txnToken: `tok_${orderId}` } });
  }
  if (path === '/v3/order/status') {
    const state = paytmState.get(parsed.body.orderId as string);
    return Response.json({ body: { resultInfo: { resultStatus: state?.status ?? 'PENDING' }, txnAmount: state?.amount, txnId: `PTM_${parsed.body.orderId as string}` } });
  }
  if (path === '/refund/apply') {
    return Response.json({ body: { resultInfo: { resultStatus: 'PENDING', resultCode: '601' }, refundId: `RF_${parsed.body.refId as string}` } });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof seedStore>>;
let beta: Awaited<ReturnType<typeof seedStore>>;
let ownerTok: string;
let variantId: string;
const pos = new InMemoryPosGateway();

const S = (storeId = alpha.store.id) => `/v1/admin/stores/${storeId}`;
const admin = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token = ownerTok, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method, url, headers: { ...bearer(token), ...headers }, ...(payload ? { payload: payload as object } : {}) });
const shop = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: unknown) =>
  ctx.app.inject({ method, url: `/v1/storefront${url}`, headers: { host: alpha.host, ...headers }, ...(payload ? { payload: payload as object } : {}) });
const runJobs = () => runDueJobs(ctx.db, jobHandlers(ctx.app.ctx), 'test-worker', 50, new Date(Date.now() + ctx.clock.offsetMs));
const settings = { merchantId: MID, merchantKey: KEY, callbackUrl: 'https://alpha.example.com/checkout/paytm', environment: 'staging', enabled: true };

/** Posts a Paytm-style form notification signed with `key`. */
function notify(fields: Record<string, string>, key = KEY) {
  const form = new URLSearchParams({ ...fields, CHECKSUMHASH: generateSignature(paramsToString(fields), key) });
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments/paytm',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form.toString(),
  });
}

async function placeAndStartPayment(phone: string) {
  const token = await customerToken(ctx, alpha.host, phone);
  const address = await shop('POST', '/me/addresses', bearer(token), { name: 'Buyer', phone, line1: '1 Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' });
  await shop('POST', '/cart/items', bearer(token), { variantId, quantity: 1 });
  const body = { addressId: address.json().address.id, paymentMethod: 'online' };
  const quote = (await shop('POST', '/checkout/quote', bearer(token), body)).json().quote;
  const order = (await shop('POST', '/checkout/orders', { ...bearer(token), 'idempotency-key': `paytm-${phone}` }, { ...body, expectedTotalPaise: quote.totalPaise })).json().order;
  const pay = await shop('POST', `/orders/${order.orderNumber}/payments`, bearer(token));
  return { token, order, pay };
}

beforeAll(async () => {
  ctx = await setupTestApp({ pos, paytmFetch: fakePaytm });
  alpha = await seedStore(ctx.db, 'alpha');
  beta = await seedStore(ctx.db, 'beta');
  ownerTok = (await adminToken(ctx, 'owner@example.com', [{ role: 'platform_owner', storeId: null }])).token;
  const product = (await admin('POST', `${S()}/products`, { slug: 'saree', title: 'Saree' })).json().product;
  variantId = (await admin('POST', `${S()}/products/${product.id}/variants`, { skuCode: 'SAR-1', title: 'One size' })).json().variant.id;
  await admin('PUT', `${S()}/variants/${variantId}/price`, { mrpPaise: 500_000, pricePaise: 450_005 });
  await admin('POST', `${S()}/products/${product.id}/status`, { status: 'published' });
  await admin('POST', `${S()}/shipping-zones`, { name: 'TN', pincodePrefixes: ['600'], chargePaise: 0, codAvailable: false });
  pos.stock.set('SAR-1', 100);
  await admin('POST', `${S()}/pos/stock-sync`);
  await runJobs();
});
afterAll(async () => ctx?.close());

describe('Paytm settings (admin)', () => {
  it('requires the merchant key the first time and never returns it', async () => {
    const { merchantKey: _k, ...withoutKey } = settings;
    expect((await admin('PUT', `${S()}/payment-gateways/paytm`, withoutKey)).statusCode).toBe(400);

    const saved = await admin('PUT', `${S()}/payment-gateways/paytm`, settings);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().paytm).toMatchObject({ configured: true, enabled: true, environment: 'staging', merchantId: MID, websiteName: 'WEBSTAGING', merchantKeySet: true });
    expect(saved.body).not.toContain(KEY);

    const read = await admin('GET', `${S()}/payment-gateways/paytm`);
    expect(read.body).not.toContain(KEY);
    expect(read.json().paytm.merchantKeySet).toBe(true);

    const [row] = await ctx.db.select().from(paymentGatewayConfigs).where(eq(paymentGatewayConfigs.storeId, alpha.store.id));
    expect(row!.merchantKeyEncrypted).not.toContain(KEY);
    expect(row!.merchantKeyEncrypted.startsWith('v1.')).toBe(true);
    const audits = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'payment_gateway.paytm.update'));
    expect(JSON.stringify(audits)).not.toContain(KEY);
    expect(audits[0]!.changes).toMatchObject({ merchantKeyChanged: true });
  });

  it('keeps the stored key when it is omitted on update', async () => {
    const { merchantKey: _k, ...withoutKey } = settings;
    const before = (await ctx.db.select().from(paymentGatewayConfigs).where(eq(paymentGatewayConfigs.storeId, alpha.store.id)))[0]!;
    expect((await admin('PUT', `${S()}/payment-gateways/paytm`, { ...withoutKey, websiteName: 'WEBSTAGING' })).statusCode).toBe(200);
    const after = (await ctx.db.select().from(paymentGatewayConfigs).where(eq(paymentGatewayConfigs.storeId, alpha.store.id)))[0]!;
    expect(after.merchantKeyEncrypted).toBe(before.merchantKeyEncrypted);
  });

  it('refuses production while the deployment has not enabled it', async () => {
    const res = await admin('PUT', `${S()}/payment-gateways/paytm`, { ...settings, environment: 'production' });
    expect(res.statusCode).toBe(409);
  });

  it('is limited to admins with store.settings.manage on that store', async () => {
    const support = (await adminToken(ctx, 'support@example.com', [{ role: 'support', storeId: alpha.store.id }])).token;
    expect((await admin('GET', `${S()}/payment-gateways/paytm`, undefined, support)).statusCode).toBe(403);
    const betaManager = (await adminToken(ctx, 'beta@example.com', [{ role: 'store_manager', storeId: beta.store.id }])).token;
    expect((await admin('PUT', `${S()}/payment-gateways/paytm`, settings, betaManager)).statusCode).toBe(403);
  });
});

describe('Paytm payments', () => {
  it('starts a staging payment with the store’s MID and a signed request, returning only browser-safe data', async () => {
    calls.length = 0;
    const { pay } = await placeAndStartPayment('9811111111');
    expect(pay.statusCode).toBe(201);
    const payment = pay.json().payment;
    expect(payment.provider).toBe('paytm');
    expect(payment.client).toMatchObject({ provider: 'paytm', environment: 'staging', mid: MID, amount: '4500.05' });
    expect(payment.client.txnToken).toBe(`tok_${payment.transactionId}`);
    expect(pay.body).not.toContain(KEY);
    expect(calls[0]!.url).toContain('https://securestage.paytmpayments.com/theia/api/v1/initiateTransaction');
    expect(calls[0]!.body).toMatchObject({ mid: MID, orderId: payment.transactionId, websiteName: 'WEBSTAGING', txnAmount: { value: '4500.05', currency: 'INR' } });
  });

  it('confirms the order only on a checksum-verified notification for the right MID and amount', async () => {
    const { order, pay } = await placeAndStartPayment('9822222222');
    const orderId = pay.json().payment.transactionId as string;
    const fields = { MID, ORDERID: orderId, TXNID: `PTM_${orderId}`, TXNAMOUNT: '4500.05', CURRENCY: 'INR', STATUS: 'TXN_SUCCESS', RESPCODE: '01' };

    const forged = await notify(fields, 'wrongKEY12345678');
    expect(forged.statusCode).toBe(400);
    expect((await notify({ ...fields, MID: 'OTHERMID' })).statusCode).toBe(400);
    expect((await notify({ ...fields, ORDERID: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(400);
    expect((await ctx.db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe('pending_payment');

    const wrongAmount = await notify({ ...fields, TXNID: 'PTM_other', TXNAMOUNT: '1.00' });
    expect(wrongAmount.json().outcome).toBe('amount_mismatch');

    const ok = await notify(fields);
    expect(ok.json()).toEqual({ received: true, outcome: 'applied' });
    expect((await notify(fields)).json().outcome).toBe('duplicate');
    const row = (await ctx.db.select().from(orders).where(eq(orders.id, order.id)))[0]!;
    expect(row).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });

  it('reconciles through the status API and refunds with Paytm’s transaction id', async () => {
    const { order, pay } = await placeAndStartPayment('9833333333');
    const orderId = pay.json().payment.transactionId as string;
    paytmState.set(orderId, { status: 'TXN_SUCCESS', amount: '4500.05' });
    ctx.clock.offsetMs = 16 * 60_000;
    await admin('POST', `${S()}/payments/reconcile`);
    await runJobs();
    ctx.clock.offsetMs = 0;
    expect((await ctx.db.select().from(orders).where(eq(orders.id, order.id)))[0]!).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });

    calls.length = 0;
    const refund = await admin('POST', `${S()}/orders/${order.id}/refunds`, { amountPaise: 100_000, reason: 'Goodwill' }, ownerTok, { 'idempotency-key': `paytm-refund-${orderId}` });
    expect(refund.statusCode).toBe(201);
    await runJobs();
    const apply = calls.find((c) => c.url.endsWith('/refund/apply'));
    expect(apply?.body).toMatchObject({ mid: MID, txnType: 'REFUND', orderId, txnId: `PTM_${orderId}`, refundAmount: '1000.00' });
  });

  it('is not offered when the store has Paytm disabled', async () => {
    await admin('PUT', `${S()}/payment-gateways/paytm`, { ...settings, enabled: false });
    const { pay } = await placeAndStartPayment('9844444444');
    expect(pay.json().payment.provider).toBe('fake');
  });
});

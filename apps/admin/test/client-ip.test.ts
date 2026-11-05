import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders, normalizeIp, trustedProxyHops } from '@/lib/client-ip';

const h = (xff?: string, extra: Record<string, string> = {}) => ({ get: (n: string) => ({ ...(xff === undefined ? {} : { 'x-forwarded-for': xff }), ...extra })[n.toLowerCase()] ?? null });

describe('clientIpFromHeaders', () => {
  it('forwards nothing when no trusted hop is configured (zero hops), whatever the browser sent', () => {
    expect(clientIpFromHeaders(h('6.6.6.6'), 0)).toBeNull();
    expect(clientIpFromHeaders(h('6.6.6.6, 198.51.100.7'), 0)).toBeNull();
  });

  it('takes the client from the right for the configured number of trusted proxies', () => {
    expect(clientIpFromHeaders(h('198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(clientIpFromHeaders(h('198.51.100.7, 10.0.0.9'), 2)).toBe('198.51.100.7');
    expect(clientIpFromHeaders(h(' 198.51.100.7 ,10.0.0.9 '), 2)).toBe('198.51.100.7');
  });

  it('ignores spoofed values placed in front of the trusted chain', () => {
    expect(clientIpFromHeaders(h('6.6.6.6, 198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(clientIpFromHeaders(h('6.6.6.6, 7.7.7.7, 198.51.100.7, 10.0.0.9'), 2)).toBe('198.51.100.7');
  });

  it('forwards nothing when the chain is shorter than the configured hops', () => {
    expect(clientIpFromHeaders(h('198.51.100.7'), 2)).toBeNull();
  });

  it('forwards nothing for a missing or empty header', () => {
    expect(clientIpFromHeaders(h(undefined), 1)).toBeNull();
    expect(clientIpFromHeaders(h(''), 1)).toBeNull();
    expect(clientIpFromHeaders(h(' , '), 1)).toBeNull();
  });

  it('never forwards a malformed or hostile value', () => {
    for (const bad of ['not-an-ip', '999.1.1.1', "1.1.1.1'; drop table x;--", '1.1.1.1/24', 'a'.repeat(300)]) {
      expect(clientIpFromHeaders(h(bad), 1)).toBeNull();
    }
  });

  it('does not read X-Real-IP', () => {
    expect(clientIpFromHeaders(h(undefined, { 'x-real-ip': '198.51.100.7' }), 1)).toBeNull();
  });

  it('accepts IPv6 and unwraps IPv4-mapped addresses', () => {
    expect(clientIpFromHeaders(h('2001:DB8::1'), 1)).toBe('2001:db8::1');
    expect(clientIpFromHeaders(h('::ffff:203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it.each([0, -1, 1.5, Number.NaN])('treats hops=%s as "no trusted proxy"', (hops) => {
    expect(clientIpFromHeaders(h('198.51.100.7'), hops)).toBeNull();
  });
});

describe('normalizeIp / trustedProxyHops', () => {
  it('validates addresses', () => {
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('nope')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  it('parses the setting and fails safe to 0', () => {
    expect(trustedProxyHops(undefined)).toBe(0);
    expect(trustedProxyHops('')).toBe(0);
    expect(trustedProxyHops('1')).toBe(1);
    expect(trustedProxyHops(' 2 ')).toBe(2);
    for (const bad of ['9', '-1', 'two', '1.5', '10', 'true']) expect(trustedProxyHops(bad)).toBe(0);
  });
});

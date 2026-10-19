import { describe, expect, it } from 'vitest';
import { normalizeHost } from '../src/modules/tenancy/host.js';

describe('normalizeHost', () => {
  it.each([
    ['Shop.Example.COM', 'shop.example.com'],
    ['shop.example.com:443', 'shop.example.com'],
    ['shop.example.com.', 'shop.example.com'],
    ['  localhost:4000 ', 'localhost'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  it.each([undefined, '', '[::1]:4000', 'shop.example.com:abc', 'bad_host.com', 'a..b', '-a.com', 'x'.repeat(254)])(
    'rejects %j',
    (input) => {
      expect(normalizeHost(input)).toBeNull();
    },
  );
});

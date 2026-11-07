import { describe, expect, it } from 'vitest';
import { parseAnnouncement } from '../lib/announcement';

describe('parseAnnouncement', () => {
  it('keeps plain text as one part', () => {
    expect(parseAnnouncement('Free shipping on orders above ₹1,999')).toEqual([{ text: 'Free shipping on orders above ₹1,999' }]);
  });
  it('turns an inline site link into a link part', () => {
    expect(parseAnnouncement('Free shipping [Shop now](/shop)')).toEqual([{ text: 'Free shipping ' }, { label: 'Shop now', href: '/shop' }]);
  });
  it('accepts https links and text after the link', () => {
    expect(parseAnnouncement('[Details](https://example.com/offer) apply')).toEqual([{ label: 'Details', href: 'https://example.com/offer' }, { text: ' apply' }]);
  });
  it('leaves unsafe or protocol-relative targets as plain text', () => {
    for (const bad of ['[x](javascript:alert(1))', '[x](//evil.example)', '[x](http://example.com)', '[x](data:text/html,hi)']) {
      expect(parseAnnouncement(bad).every((p) => 'text' in p)).toBe(true);
    }
  });
});

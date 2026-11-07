import { describe, expect, it } from 'vitest';
import { colourHex } from '../lib/colours';

describe('colourHex', () => {
  it('maps common ethnic-wear colour names, ignoring case and spacing', () => {
    expect(colourHex('Rust')).toBe('#a0522d');
    expect(colourHex('  Bottle   Green ')).toBe('#006a4e');
  });

  it('passes hex codes through and returns null for unknown names', () => {
    expect(colourHex('#5B277A')).toBe('#5b277a');
    expect(colourHex('Sunset Glow')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { layoutStyle } from '../lib/format';

describe('layoutStyle', () => {
  it('falls back to the defaults when the store has not set anything', () => {
    expect(layoutStyle(undefined)).toEqual({ '--prod-m': '2', '--prod-t': '3', '--prod-d': '4', '--cat-m': '2', '--cat-t': '3', '--cat-d': '5' });
  });

  it('uses the store numbers and derives the tablet count between them', () => {
    expect(layoutStyle({ products: { mobile: 1, desktop: 6 }, categories: { mobile: 3, desktop: 4 } })).toEqual({
      '--prod-m': '1',
      '--prod-t': '3',
      '--prod-d': '6',
      '--cat-m': '3',
      '--cat-t': '3',
      '--cat-d': '4',
    });
  });

  it('never lets the tablet count exceed the computer count, and clamps out-of-range or non-integer values', () => {
    const out = layoutStyle({ products: { mobile: 2, desktop: 2 }, categories: { mobile: 9, desktop: 1.5 } });
    expect(out['--prod-t']).toBe('2');
    expect(out['--cat-m']).toBe('3');
    expect(out['--cat-d']).toBe('5');
  });
});

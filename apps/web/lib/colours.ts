/**
 * Swatch colour for a variant colour name. Common ethnic-wear names that CSS does not know get a hand-picked shade; anything
 * else is passed through when it is a plain CSS colour word, otherwise null (the swatch then shows a neutral dot with the name).
 */
const NAMED: Record<string, string> = {
  rust: '#a0522d',
  mustard: '#d4a017',
  wine: '#722f37',
  maroon: '#800000',
  peach: '#f6b89a',
  mauve: '#b784a7',
  'rani pink': '#e0218a',
  rani: '#e0218a',
  'bottle green': '#006a4e',
  'off white': '#f5f1e8',
  'off-white': '#f5f1e8',
  cream: '#f3e9d2',
  ivory: '#fffff0',
  beige: '#e8d9b5',
  olive: '#6b7a2f',
  teal: '#0f7c7c',
  navy: '#1f2a52',
  'navy blue': '#1f2a52',
  magenta: '#c2185b',
  lavender: '#b9a7d9',
  lilac: '#c8a2c8',
  mint: '#a8dcc0',
  'mint green': '#a8dcc0',
  'sea green': '#2e8b57',
  'powder blue': '#b0d0e8',
  'sky blue': '#87ceeb',
  coral: '#f2775f',
  gold: '#c9a227',
  silver: '#c0c0c0',
  black: '#1a1a1a',
  white: '#ffffff',
  grey: '#8a8a8a',
  gray: '#8a8a8a',
  red: '#c62828',
  pink: '#f48fb1',
  yellow: '#f2c94c',
  orange: '#e8833a',
  green: '#3f8f4f',
  blue: '#2f5fb3',
  purple: '#6a3d9a',
  brown: '#7b4a2d',
};

export function colourHex(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (NAMED[key]) return NAMED[key];
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(key) ? key : null;
}

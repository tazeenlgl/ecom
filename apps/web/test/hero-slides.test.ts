import { describe, expect, it } from 'vitest';
import { AUTOPLAY_MS, MAX_SLIDES, planHomepage, shouldAutoplay, toSlide, wrapIndex } from '@/lib/hero-slides';
import type { Block, HomepageSection } from '@/lib/types';

const block = (key: string, data: HomepageSection, position = 0): Block<HomepageSection> => ({ key, title: null, data, position });
const slide = (n: number, extra: Partial<HomepageSection> = {}) => block(`hero-slide-${n}`, { layout: 'hero', heading: `S${n}`, image: { url: `/p/${n}.jpg`, alt: `a${n}` }, link: { label: 'Go', href: `/s${n}` }, ...extra }, n);
const grid = block('new', { layout: 'product_grid', heading: 'New' }, 9);

describe('planHomepage: which blocks become a carousel', () => {
  it('leaves the classic single hero and every other section exactly as before', () => {
    const blocks = [block('hero', { layout: 'hero', heading: 'H' }), grid, block('story', { layout: 'rich_text', heading: 'R' })];
    expect(planHomepage(blocks)).toEqual(blocks.map((b) => ({ kind: 'section', key: b.key, section: b.data })));
  });

  it('groups only layout=hero blocks keyed hero-slide-N, placed where the first slide sits', () => {
    const items = planHomepage([slide(1), grid, slide(2), slide(3)]);
    expect(items.map((i) => i.kind)).toEqual(['carousel', 'section']);
    expect(items[0]).toMatchObject({ kind: 'carousel', slides: [{ key: 'hero-slide-1' }, { key: 'hero-slide-2' }, { key: 'hero-slide-3' }] });
  });

  it('does not group a hero with another key, or a hero-slide key with another layout', () => {
    const plain = block('hero', { layout: 'hero', heading: 'H', image: { url: '/x.jpg' } });
    const wrongLayout = block('hero-slide-2', { layout: 'rich_text', heading: 'R' });
    const items = planHomepage([slide(1), plain, wrongLayout, slide(3)]);
    expect(items.filter((i) => i.kind === 'carousel')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'section').map((i) => (i as { key: string }).key)).toEqual(['hero', 'hero-slide-2']);
  });

  it('caps the carousel at three slides', () => {
    const items = planHomepage([slide(1), slide(2), slide(3), slide(4)]);
    expect((items[0] as { slides: unknown[] }).slides).toHaveLength(MAX_SLIDES);
  });

  it('copes with zero, one or two configured slides', () => {
    expect(planHomepage([])).toEqual([]);
    expect(planHomepage([slide(1)])).toEqual([{ kind: 'section', key: 'hero-slide-1', section: slide(1).data }]); // lone slide: static hero
    expect(planHomepage([slide(1), slide(2)])[0]!.kind).toBe('carousel');
  });

  it('skips incomplete slides instead of breaking', () => {
    const noImage = block('hero-slide-2', { layout: 'hero', heading: 'No image' }, 2);
    const items = planHomepage([slide(1), noImage, slide(3)]);
    expect(items).toHaveLength(1);
    expect((items[0] as { slides: { key: string }[] }).slides.map((s) => s.key)).toEqual(['hero-slide-1', 'hero-slide-3']);
    // Only one usable slide left: static hero for it, nothing for the incomplete one.
    expect(planHomepage([slide(1), noImage])).toEqual([{ kind: 'section', key: 'hero-slide-1', section: slide(1).data }]);
  });
});

describe('toSlide', () => {
  it('uses the mobile image only when present and defaults and clamps the focal point', () => {
    expect(toSlide(slide(1))!.mobileImage).toBeUndefined();
    expect(toSlide(slide(1))!.focus).toEqual({ x: 50, y: 20 });
    const s = toSlide(slide(1, { mobileImage: { url: '/m.jpg' }, imageFocus: { x: 120, y: -5 } }))!;
    expect(s.mobileImage?.url).toBe('/m.jpg');
    expect(s.focus).toEqual({ x: 100, y: 0 });
    expect(toSlide(slide(1, { mobileImage: { url: '' } }))!.mobileImage).toBeUndefined();
  });
});

describe('wrapIndex and shouldAutoplay', () => {
  it('wraps both ways', () => {
    expect([wrapIndex(3, 3), wrapIndex(-1, 3), wrapIndex(1, 3), wrapIndex(0, 0)]).toEqual([0, 2, 1, 0]);
  });
  const base = { count: 3, reducedMotion: false, hovered: false, focused: false, hidden: false, offscreen: false, userPaused: false };
  it('plays only when nothing asks it to stop, and reduced motion always wins', () => {
    expect(AUTOPLAY_MS).toBeGreaterThanOrEqual(5000);
    expect(AUTOPLAY_MS).toBeLessThanOrEqual(6000);
    expect(shouldAutoplay(base)).toBe(true);
    for (const k of ['reducedMotion', 'hovered', 'focused', 'hidden', 'offscreen', 'userPaused'] as const) expect(shouldAutoplay({ ...base, [k]: true }), k).toBe(false);
    expect(shouldAutoplay({ ...base, count: 1 })).toBe(false);
  });
});

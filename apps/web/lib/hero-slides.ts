import type { Block, HomepageSection, Image, Link } from './types';

/**
 * Hero carousel slides are homepage_section blocks that are BOTH layout "hero" AND have a key of the form
 * `hero-slide-<n>` (n = 1..MAX_SLIDES). Nothing else is ever grouped: a block with any other layout, or a hero with
 * any other key (including the classic single `hero`), renders exactly as before, in its own place.
 *
 * Slides are ordered by the blocks' own `position` (the API already returns them ordered). The carousel renders where
 * the first slide block sits; the other slide blocks are skipped there. Fewer than MIN_SLIDES usable slides: the lone
 * slide (if any) is rendered as the ordinary static hero. A slide block without a desktop image is never rendered.
 */
export const SLIDE_KEY = /^hero-slide-[1-9]\d?$/;
export const MAX_SLIDES = 3;
export const MIN_SLIDES = 2;

export type HeroSlide = { key: string; heading?: string; body?: string; image: Image; mobileImage?: Image; focus: { x: number; y: number }; link?: Link };

export const isSlideBlock = (b: Block<HomepageSection>): boolean => b.data.layout === 'hero' && SLIDE_KEY.test(b.key);

const clamp = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback);

/** A slide needs a desktop image (the layout is image-led); anything else is skipped so the page never breaks. */
export function toSlide(b: Block<HomepageSection>): HeroSlide | null {
  const d = b.data;
  if (!d.image?.url) return null;
  return {
    key: b.key,
    heading: d.heading,
    body: d.body,
    image: d.image,
    mobileImage: d.mobileImage?.url ? d.mobileImage : undefined,
    focus: { x: clamp(d.imageFocus?.x, 50), y: clamp(d.imageFocus?.y, 20) },
    link: d.link?.href ? d.link : undefined,
  };
}

export type HomeItem = { kind: 'section'; key: string; section: HomepageSection } | { kind: 'carousel'; slides: HeroSlide[] };

/** Turns the ordered blocks into render items: non-slide blocks pass through untouched. */
export function planHomepage(blocks: Block<HomepageSection>[]): HomeItem[] {
  const slideBlocks = blocks.filter(isSlideBlock);
  const slides = slideBlocks.map(toSlide).filter((s): s is HeroSlide => s !== null).slice(0, MAX_SLIDES);
  const carousel = slides.length >= MIN_SLIDES;
  const items: HomeItem[] = [];
  let placed = false;
  for (const b of blocks) {
    if (isSlideBlock(b)) {
      if (carousel) {
        if (!placed) items.push({ kind: 'carousel', slides });
        placed = true;
        continue;
      }
      if (!toSlide(b)) continue; // an incomplete slide (no desktop image) is never rendered
    }
    items.push({ kind: 'section', key: b.key, section: b.data });
  }
  return items;
}

export const wrapIndex = (i: number, count: number): number => (count <= 0 ? 0 : ((i % count) + count) % count);

export const AUTOPLAY_MS = 5500;

/** Autoplay runs only when nothing asks it to stop. Reduced motion always wins. */
export function shouldAutoplay(s: { count: number; reducedMotion: boolean; hovered: boolean; focused: boolean; hidden: boolean; offscreen: boolean; userPaused: boolean }): boolean {
  return s.count >= MIN_SLIDES && !s.reducedMotion && !s.hovered && !s.focused && !s.hidden && !s.offscreen && !s.userPaused;
}

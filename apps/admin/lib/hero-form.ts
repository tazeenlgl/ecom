/**
 * Homepage hero slides as the Admin edits them. Storage is the existing `homepage_section` block: layout "hero" with
 * key `hero-slide-<n>` (n = 1..3). The storefront groups exactly those blocks into the carousel (see
 * apps/web/lib/hero-slides.ts); this module only maps between the form and that block.
 */
export const SLOTS = [1, 2, 3] as const;
export const slotKey = (n: number) => `hero-slide-${n}`;
export const SLIDE_KEY = /^hero-slide-[1-3]$/;

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 8_000_000;

export type Img = { url: string; alt: string };
export type SlideForm = {
  slot: number;
  id?: string;
  heading: string;
  body: string;
  linkLabel: string;
  linkHref: string;
  image: Img | null;
  mobileImage: Img | null;
  focusX: number;
  focusY: number;
  status: 'draft' | 'published';
  position: number;
};

export type ApiBlock = { id: string; kind: string; key: string; title: string | null; data: Record<string, unknown>; status: 'draft' | 'published'; position: number };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const img = (v: unknown): Img | null => {
  const o = v as { url?: unknown; alt?: unknown } | undefined;
  return o && typeof o.url === 'string' && o.url ? { url: o.url, alt: str(o.alt) } : null;
};
const pct = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback);

export function emptySlide(slot: number): SlideForm {
  return { slot, heading: '', body: '', linkLabel: '', linkHref: '/shop', image: null, mobileImage: null, focusX: 50, focusY: 20, status: 'draft', position: slot };
}

export function formFromBlock(slot: number, block?: ApiBlock): SlideForm {
  if (!block) return emptySlide(slot);
  const d = block.data;
  const link = d.link as { label?: unknown; href?: unknown } | undefined;
  const focus = d.imageFocus as { x?: unknown; y?: unknown } | undefined;
  return {
    slot,
    id: block.id,
    heading: str(d.heading),
    body: str(d.body),
    linkLabel: str(link?.label),
    linkHref: str(link?.href) || '/shop',
    image: img(d.image),
    mobileImage: img(d.mobileImage),
    focusX: pct(focus?.x, 50),
    focusY: pct(focus?.y, 20),
    status: block.status,
    position: block.position,
  };
}

/** Field errors for saving as `status`. A draft may be incomplete; a published slide must be complete. */
export function validateSlide(f: SlideForm, status: 'draft' | 'published'): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.heading.length > 200) e.heading = 'At most 200 characters.';
  if (f.body.length > 5000) e.body = 'At most 5000 characters.';
  const hasLabel = f.linkLabel.trim() !== '';
  if (hasLabel && f.linkLabel.trim().length > 80) e.linkLabel = 'At most 80 characters.';
  if (hasLabel && !/^(\/|https:\/\/)/.test(f.linkHref.trim())) e.linkHref = 'Start with / for a page on this store, or https:// for another site.';
  if (hasLabel && f.linkHref.length > 500) e.linkHref = 'At most 500 characters.';
  if (!hasLabel && f.linkHref.trim() !== '' && f.linkHref.trim() !== '/shop') e.linkLabel = 'Enter the button text, or clear the destination.';
  for (const [name, i] of [['image', f.image], ['mobileImage', f.mobileImage]] as const) {
    if (i && i.alt.length > 300) e[`${name}Alt`] = 'At most 300 characters.';
  }
  if (status === 'published') {
    if (!f.image) e.image = 'Upload a desktop image before publishing.';
    else if (!f.image.alt.trim()) e.imageAlt = 'Describe the desktop image for screen readers before publishing.';
    if (!f.heading.trim()) e.heading = 'Enter a heading before publishing.';
  }
  return e;
}

/** The body for PUT /stores/:storeId/blocks. A removed mobile image is simply omitted, so the storefront falls back to the desktop image. */
export function blockBody(f: SlideForm, status: 'draft' | 'published') {
  const data: Record<string, unknown> = { layout: 'hero', imageFocus: { x: clamp(f.focusX), y: clamp(f.focusY) } };
  if (f.heading.trim()) data.heading = f.heading.trim();
  if (f.body.trim()) data.body = f.body.trim();
  if (f.linkLabel.trim()) data.link = { label: f.linkLabel.trim(), href: f.linkHref.trim() };
  if (f.image) data.image = { url: f.image.url, ...(f.image.alt.trim() ? { alt: f.image.alt.trim() } : {}) };
  if (f.mobileImage) data.mobileImage = { url: f.mobileImage.url, alt: (f.mobileImage.alt.trim() || f.image?.alt.trim() || undefined) };
  if (data.mobileImage && (data.mobileImage as { alt?: string }).alt === undefined) delete (data.mobileImage as { alt?: string }).alt;
  return { kind: 'homepage_section' as const, key: slotKey(f.slot), title: `Hero slide ${f.slot}`, status, position: f.position, data };
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/** Slots in display order: by position, then slot number. */
export const inOrder = (forms: SlideForm[]) => [...forms].sort((a, b) => a.position - b.position || a.slot - b.slot);

/** Advice about an image's size and shape. Advisory only: nothing is refused. */
export function imageAdvice(kind: 'desktop' | 'mobile', width: number, height: number): string[] {
  const out: string[] = [];
  const ratio = width / height;
  if (kind === 'desktop') {
    if (width < 1920) out.push(`${width}px wide: 1920px or more is recommended so it stays sharp on large screens.`);
    if (ratio < 1.5 || ratio > 2) out.push('Landscape about 16:9 works best; other shapes are cropped to fit.');
  } else {
    if (width < 1080) out.push(`${width}px wide: 1080px or more is recommended.`);
    if (ratio < 0.7 || ratio > 1.1) out.push('Portrait about 4:5 works best on phones.');
  }
  return out;
}

/** Development uploads live at https://local-media.test/<key> and are served by the API; show them through /dev-media. */
export function mediaSrc(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'local-media.test') return `/dev-media${u.pathname}`;
  } catch {
    // relative or invalid: use as is
  }
  return url;
}

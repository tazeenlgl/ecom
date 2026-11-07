import { describe, expect, it } from 'vitest';
import { type ApiBlock, blockBody, emptySlide, formFromBlock, imageAdvice, inOrder, mediaSrc, slotKey, validateSlide } from '@/lib/hero-form';

const block = (data: Record<string, unknown>, extra: Partial<ApiBlock> = {}): ApiBlock => ({ id: 'b1', kind: 'homepage_section', key: 'hero-slide-1', title: null, data, status: 'published', position: 2, ...extra });

describe('slide form <-> block', () => {
  it('uses the key the storefront groups on', () => {
    expect([1, 2, 3].map(slotKey)).toEqual(['hero-slide-1', 'hero-slide-2', 'hero-slide-3']);
    expect(blockBody(emptySlide(2), 'draft')).toMatchObject({ kind: 'homepage_section', key: 'hero-slide-2', data: { layout: 'hero' } });
  });

  it('reads an existing block and writes the same data back', () => {
    const b = block({ layout: 'hero', heading: 'H', body: 'B', link: { label: 'Go', href: '/shop' }, image: { url: 'https://media.example.com/d.jpg', alt: 'd' }, mobileImage: { url: 'https://media.example.com/m.jpg', alt: 'm' }, imageFocus: { x: 30, y: 70 } });
    const f = formFromBlock(1, b);
    expect(f).toMatchObject({ id: 'b1', heading: 'H', focusX: 30, focusY: 70, status: 'published', position: 2 });
    expect(blockBody(f, 'published').data).toEqual(b.data);
  });

  it('omits a removed mobile image so the storefront falls back to the desktop image', () => {
    const f = { ...formFromBlock(1, block({ layout: 'hero', image: { url: 'https://m.example.com/d.jpg', alt: 'd' }, mobileImage: { url: 'https://m.example.com/m.jpg' } })), mobileImage: null };
    expect(blockBody(f, 'draft').data).not.toHaveProperty('mobileImage');
    expect(blockBody(f, 'draft').data.image).toEqual({ url: 'https://m.example.com/d.jpg', alt: 'd' });
  });

  it('gives a mobile image without its own alt text the desktop alt text', () => {
    const f = { ...emptySlide(1), image: { url: 'https://m.example.com/d.jpg', alt: 'desk' }, mobileImage: { url: 'https://m.example.com/m.jpg', alt: '' } };
    expect((blockBody(f, 'draft').data.mobileImage as { alt: string }).alt).toBe('desk');
  });

  it('clamps focal points to 0 to 100 and defaults missing ones', () => {
    expect(formFromBlock(1, block({ layout: 'hero', imageFocus: { x: 500, y: -4 } }))).toMatchObject({ focusX: 100, focusY: 0 });
    expect(formFromBlock(1, block({ layout: 'hero' }))).toMatchObject({ focusX: 50, focusY: 20 });
    expect(blockBody({ ...emptySlide(1), focusX: 140, focusY: -9 }, 'draft').data.imageFocus).toEqual({ x: 100, y: 0 });
  });
});

describe('validation', () => {
  const ok = { ...emptySlide(1), heading: 'H', image: { url: 'https://m.example.com/d.jpg', alt: 'A model' }, linkLabel: 'Go', linkHref: '/shop' };
  it('lets a draft be incomplete but not a published slide', () => {
    expect(validateSlide(emptySlide(1), 'draft')).toEqual({});
    const e = validateSlide(emptySlide(1), 'published');
    expect(Object.keys(e).sort()).toEqual(['heading', 'image']);
    expect(validateSlide({ ...ok, image: { url: ok.image.url, alt: '' } }, 'published')).toHaveProperty('imageAlt');
    expect(validateSlide(ok, 'published')).toEqual({});
  });
  it('checks the button destination', () => {
    expect(validateSlide({ ...ok, linkHref: 'shop' }, 'draft')).toHaveProperty('linkHref');
    expect(validateSlide({ ...ok, linkHref: 'http://x.example' }, 'draft')).toHaveProperty('linkHref');
    expect(validateSlide({ ...ok, linkHref: 'https://x.example/a' }, 'draft')).toEqual({});
    expect(validateSlide({ ...ok, linkLabel: '', linkHref: '/sale' }, 'draft')).toHaveProperty('linkLabel');
  });
});

describe('ordering and advice', () => {
  it('orders by position then slot', () => {
    const forms = [{ ...emptySlide(1), position: 3 }, { ...emptySlide(2), position: 1 }, { ...emptySlide(3), position: 1 }];
    expect(inOrder(forms).map((f) => f.slot)).toEqual([2, 3, 1]);
  });
  it('advises on size and shape without refusing', () => {
    expect(imageAdvice('desktop', 1920, 1080)).toEqual([]);
    expect(imageAdvice('desktop', 1200, 1200)).toHaveLength(2);
    expect(imageAdvice('mobile', 1080, 1350)).toEqual([]);
    expect(imageAdvice('mobile', 800, 400)).toHaveLength(2);
  });
  it('shows development uploads through /dev-media and leaves other addresses alone', () => {
    expect(mediaSrc('https://local-media.test/stores/s/hero/a.png')).toBe('/dev-media/stores/s/hero/a.png');
    expect(mediaSrc('https://media.tazeen.in/stores/s/hero/a.png')).toBe('https://media.tazeen.in/stores/s/hero/a.png');
    expect(mediaSrc('https://evil.local-media.test/a.png')).toBe('https://evil.local-media.test/a.png');
  });
});

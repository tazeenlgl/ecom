'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/components/store-context';
import { Badge, Card, Denied, ErrorNote, Field, Loading, PageHeader, useToast } from '@/components/ui';
import { api, errorText, uploadImage } from '@/lib/client';
import {
  ACCEPTED_TYPES,
  type ApiBlock,
  blockBody,
  formFromBlock,
  type Img,
  imageAdvice,
  inOrder,
  MAX_UPLOAD_BYTES,
  mediaSrc,
  SLIDE_KEY,
  type SlideForm,
  SLOTS,
  slotKey,
  validateSlide,
} from '@/lib/hero-form';
import { useFetch } from '@/lib/hooks';

type Upload = { url: string; width: number; height: number };

export default function HomepageHeroPage() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: ApiBlock[] }>(s('blocks'));
  if (!can('store.read')) return <Denied what="view the homepage hero" />;
  const sections = (data?.items ?? []).filter((b) => b.kind === 'homepage_section');
  const slideBlocks = new Map(sections.filter((b) => SLIDE_KEY.test(b.key)).map((b) => [b.key, b]));
  const forms = SLOTS.map((n) => formFromBlock(n, slideBlocks.get(slotKey(n))));
  const publishedSlides = forms.filter((f) => f.status === 'published' && f.id).length;
  const classicHero = sections.find((b) => !SLIDE_KEY.test(b.key) && b.data.layout === 'hero' && b.status === 'published');

  return (
    <>
      <PageHeader title="Homepage hero" subtitle="Up to three slides at the top of the storefront homepage. Drafts are visible only here until you publish them." />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="mb-4 space-y-2 text-sm">
            <p className="rounded-lg bg-surface px-4 py-3 text-muted ring-1 ring-line">
              {publishedSlides >= 2 ? `${publishedSlides} slides are published: the storefront shows them as a carousel.` : publishedSlides === 1 ? 'One slide is published: the storefront shows a single static hero. Publish at least two for a carousel.' : 'No slide is published, so the storefront shows its existing homepage hero.'}
            </p>
            {classicHero && publishedSlides >= 1 && (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-amber-200">A classic homepage hero ("{String(classicHero.data.heading ?? classicHero.key)}") is also published and will show on the storefront in addition to these slides. Unpublish it under Content if you do not want both.</p>
            )}
          </div>
          <div className="space-y-6">
            {inOrder(forms).map((f) => (
              <SlideCard key={`${f.slot}-${f.id ?? 'new'}-${slideBlocks.get(slotKey(f.slot))?.status}`} initial={f} onSaved={reload} writable={can('content.write')} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function SlideCard({ initial, onSaved, writable }: { initial: SlideForm; onSaved: () => Promise<void>; writable: boolean }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState<SlideForm>(initial);
  const [dims, setDims] = useState<{ desktop?: [number, number]; mobile?: [number, number] }>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (patch: Partial<SlideForm>) => setF((p) => ({ ...p, ...patch }));
  const live = initial.status === 'published' && Boolean(initial.id);

  async function upload(which: 'desktop' | 'mobile', file: File | undefined) {
    if (!file) return;
    setFailure(null);
    if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return setFailure('Choose a JPEG, PNG or WebP image.');
    if (file.size > MAX_UPLOAD_BYTES) return setFailure(`The image is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1e6} MB.`);
    setBusy(`upload-${which}`);
    try {
      const up = await uploadImage<Upload>(s('media?purpose=hero'), file);
      setDims((d) => ({ ...d, [which]: [up.width, up.height] }));
      const prev = which === 'desktop' ? f.image : f.mobileImage;
      const next: Img = { url: up.url, alt: prev?.alt ?? '' };
      set(which === 'desktop' ? { image: next } : { mobileImage: next });
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(status: 'draft' | 'published') {
    const v = validateSlide(f, status);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(status);
    setFailure(null);
    try {
      await api(s('blocks'), { method: 'PUT', body: blockBody(f, status) });
      toast('ok', status === 'published' ? `Slide ${f.slot} is published.` : `Slide ${f.slot} saved as a draft.`);
      await onSaved();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const imageAlt = f.image?.alt ?? '';
  return (
    <Card
      title={`Slide ${f.slot}`}
      actions={
        <span className="flex items-center gap-2">
          {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          <Badge tone={live ? 'ok' : 'neutral'}>{live ? 'Published' : initial.id ? 'Draft: not on the storefront' : 'Not created yet'}</Badge>
        </span>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Field label="Heading" error={errors.heading}>{(p) => <input {...p} className="field" value={f.heading} onChange={(e) => set({ heading: e.target.value })} disabled={!writable} />}</Field>
          <Field label="Supporting text" error={errors.body}>{(p) => <textarea {...p} className="field min-h-20" value={f.body} onChange={(e) => set({ body: e.target.value })} disabled={!writable} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button text" error={errors.linkLabel}>{(p) => <input {...p} className="field" value={f.linkLabel} onChange={(e) => set({ linkLabel: e.target.value })} disabled={!writable} />}</Field>
            <Field label="Button destination" error={errors.linkHref} hint="/shop or https://…">{(p) => <input {...p} className="field" value={f.linkHref} onChange={(e) => set({ linkHref: e.target.value })} disabled={!writable} />}</Field>
          </div>

          <ImageControl
            title="Desktop image"
            note="Landscape, about 16:9, at least 1920px wide. JPEG, PNG or WebP, up to 8 MB."
            img={f.image}
            alt={imageAlt}
            altError={errors.imageAlt}
            error={errors.image}
            dims={dims.desktop}
            kind="desktop"
            busy={busy === 'upload-desktop'}
            writable={writable}
            onFile={(file) => upload('desktop', file)}
            onAlt={(alt) => f.image && set({ image: { ...f.image, alt } })}
            onRemove={f.image ? () => set({ image: null }) : undefined}
          />
          <ImageControl
            title="Mobile image (optional)"
            note="Portrait, about 4:5, at least 1080px wide. Without one, phones use the desktop image."
            img={f.mobileImage}
            alt={f.mobileImage?.alt ?? ''}
            altError={errors.mobileImageAlt}
            dims={dims.mobile}
            kind="mobile"
            busy={busy === 'upload-mobile'}
            writable={writable}
            onFile={(file) => upload('mobile', file)}
            onAlt={(alt) => f.mobileImage && set({ mobileImage: { ...f.mobileImage, alt } })}
            onRemove={f.mobileImage ? () => set({ mobileImage: null }) : undefined}
          />

          <fieldset className="rounded-lg border border-line p-4" disabled={!writable}>
            <legend className="px-1 text-sm font-medium">Image focus</legend>
            <p className="mb-3 text-xs text-muted">The part of the image that stays in view when it is cropped. Click the picture or use the sliders.</p>
            <FocusPicker f={f} onChange={(x, y) => set({ focusX: x, focusY: y })} />
          </fieldset>

          <Field label="Position in the carousel" hint="1 is first. Slides with the same number keep slide-number order.">
            {(p) => (
              <select {...p} className="field w-32" value={f.position} onChange={(e) => set({ position: Number(e.target.value) })} disabled={!writable}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </Field>

          {failure && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{failure}</p>}
          {writable ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => save('draft')} disabled={busy !== null}>{live ? 'Unpublish (save as draft)' : 'Save draft'}</button>
              <button className="btn-primary" onClick={() => save('published')} disabled={busy !== null}>{live ? 'Save changes (stays published)' : 'Publish'}</button>
            </div>
          ) : (
            <p className="text-sm text-muted">You can view this page but not change it.</p>
          )}
        </div>

        <div className="space-y-4">
          <p className="text-xs text-muted">Preview of your current edits. Only you see it, inside Admin; nothing here is public until you publish.</p>
          <Preview f={f} mode="desktop" />
          <Preview f={f} mode="mobile" />
        </div>
      </div>
    </Card>
  );
}

function ImageControl(props: {
  title: string;
  note: string;
  img: Img | null;
  alt: string;
  altError?: string;
  error?: string;
  dims?: [number, number];
  kind: 'desktop' | 'mobile';
  busy: boolean;
  writable: boolean;
  onFile: (f: File | undefined) => void;
  onAlt: (alt: string) => void;
  onRemove?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  useEffect(() => setNatural(null), [props.img?.url]);
  const size = props.dims ?? natural;
  const advice = size ? imageAdvice(props.kind, size[0], size[1]) : [];
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{props.title}</p>
        {size && <span className="text-xs text-muted">{size[0]} × {size[1]} px</span>}
      </div>
      <p className="mb-3 text-xs text-muted">{props.note}</p>
      {props.img && (
        // eslint-disable-next-line @next/next/no-img-element -- Admin shows the stored address as is
        <img src={mediaSrc(props.img.url)} alt="" onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} className="mb-3 max-h-32 rounded border border-line object-contain" />
      )}
      {props.error && <p role="alert" className="mb-2 text-sm text-red-700">{props.error}</p>}
      {advice.map((a) => <p key={a} className="mb-1 text-xs text-amber-800">{a}</p>)}
      {props.writable && (
        <div className="mb-3 flex flex-wrap gap-2">
          <input ref={input} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" aria-label={`${props.title}: choose a file`} onChange={(e) => { props.onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={props.busy}>{props.busy ? 'Uploading…' : props.img ? 'Replace image' : 'Upload image'}</button>
          {props.onRemove && <button type="button" className="btn-ghost" onClick={props.onRemove} disabled={props.busy}>Remove</button>}
        </div>
      )}
      {props.img && (
        <Field label="Describe the image (alt text)" error={props.altError} hint="For screen readers, for example: a model in a plum kurta set. Do not claim fabric or craft details you have not confirmed.">
          {(p) => <input {...p} className="field" value={props.alt} onChange={(e) => props.onAlt(e.target.value)} disabled={!props.writable} />}
        </Field>
      )}
    </div>
  );
}

function FocusPicker({ f, onChange }: { f: SlideForm; onChange: (x: number, y: number) => void }) {
  const src = f.image ?? f.mobileImage;
  const ref = useRef<HTMLDivElement>(null);
  const pick = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    onChange(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))), Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))));
  };
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        {src ? (
          <div ref={ref} className="relative cursor-crosshair overflow-hidden rounded border border-line" onClick={pick}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Admin shows the stored address as is */}
            <img src={mediaSrc(src.url)} alt="" className="block h-auto w-full" draggable={false} />
            <span aria-hidden className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow" style={{ left: `${f.focusX}%`, top: `${f.focusY}%` }} />
          </div>
        ) : (
          <p className="rounded border border-dashed border-line p-4 text-xs text-muted">Upload an image to set its focus.</p>
        )}
      </div>
      <div className="space-y-3">
        {([['Horizontal', 'focusX'], ['Vertical', 'focusY']] as const).map(([label, k]) => (
          <label key={k} className="block text-sm">
            <span className="mb-1 flex justify-between"><span>{label}</span><span className="text-muted">{f[k]}%</span></span>
            <input type="range" min={0} max={100} value={f[k]} className="w-full" onChange={(e) => onChange(k === 'focusX' ? Number(e.target.value) : f.focusX, k === 'focusY' ? Number(e.target.value) : f.focusY)} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** What visitors would see, using the same crop rules as the storefront (cover, anchored at the focus point). */
function Preview({ f, mode }: { f: SlideForm; mode: 'desktop' | 'mobile' }) {
  const mobile = mode === 'mobile';
  const img = mobile ? (f.mobileImage ?? f.image) : f.image;
  const fallback = mobile && !f.mobileImage && f.image;
  return (
    <figure>
      <figcaption className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{mobile ? 'Phone' : 'Desktop'} preview</span>
        {fallback && <span>No mobile image: using the desktop image</span>}
      </figcaption>
      <div className={`relative overflow-hidden rounded-lg bg-slate-200 ring-1 ring-line ${mobile ? 'aspect-[4/5] w-56' : 'aspect-video w-full'}`}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- Admin shows the stored address as is
          <img src={mediaSrc(img.url)} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: `${f.focusX}% ${f.focusY}%` }} />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">No image yet</span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1f1626]/65 via-[#1f1626]/10 to-transparent" />
        <div className={`absolute inset-x-0 bottom-0 text-white ${mobile ? 'p-3' : 'p-6'}`}>
          <p className={`font-serif leading-tight ${mobile ? 'text-lg' : 'text-3xl'}`}>{f.heading || 'Heading'}</p>
          {f.body && <p className={`mt-1 opacity-90 ${mobile ? 'text-[10px]' : 'text-sm'}`}>{f.body}</p>}
          {f.linkLabel && <span className={`mt-2 inline-block rounded-full bg-[#fbf8f5] font-medium uppercase tracking-wider text-[#5b277a] ${mobile ? 'px-3 py-1 text-[9px]' : 'px-5 py-2 text-xs'}`}>{f.linkLabel}</span>}
        </div>
      </div>
    </figure>
  );
}

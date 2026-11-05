'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { ErrorNote, Field, validate } from '@/components/ui';
import { errorText } from '@/lib/client';
import { slugify } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

export type ProductFormValues = { slug: string; title: string; description: string | null; taxRateBps: number; hsnCode: string | null; sizeChartId: string | null; categoryIds: string[] };
type Category = { id: string; name: string; parentId: string | null; isActive: boolean };
type SizeChart = { id: string; name: string };

const schema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only.').max(120),
  description: z.string().max(10000),
  gstPercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'Enter a GST percentage such as 5 or 12.').refine((v) => Number(v) <= 28, 'GST cannot exceed 28%.'),
  hsnCode: z.string().trim().max(16),
});

export function ProductForm({ initial, submitLabel, onSubmit }: { initial?: Partial<ProductFormValues>; submitLabel: string; onSubmit: (v: ProductFormValues) => Promise<void> }) {
  const { s } = useStore();
  const cats = useFetch<{ items: Category[] }>(s('categories'));
  const charts = useFetch<{ items: SizeChart[] }>(s('size-charts'));
  const [f, setF] = useState({
    title: initial?.title ?? '',
    slug: initial?.slug ?? '',
    description: initial?.description ?? '',
    gstPercent: String((initial?.taxRateBps ?? 500) / 100),
    hsnCode: initial?.hsnCode ?? '',
    sizeChartId: initial?.sizeChartId ?? '',
    categoryIds: initial?.categoryIds ?? ([] as string[]),
  });
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      noValidate
      className="card space-y-5 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = validate(schema, f);
        setErrors(v.errors);
        if (!v.data) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit({
            title: v.data.title,
            slug: v.data.slug,
            description: v.data.description.trim() || null,
            taxRateBps: Math.round(Number(v.data.gstPercent) * 100),
            hsnCode: v.data.hsnCode || null,
            sizeChartId: f.sizeChartId || null,
            categoryIds: f.categoryIds,
          });
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={errors.title}>{(p) => <input {...p} className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} />}</Field>
        <Field label="URL slug" error={errors.slug} hint="Appears in the storefront address.">{(p) => <input {...p} className="field" value={f.slug} onChange={(e) => (setSlugTouched(true), setF({ ...f, slug: e.target.value }))} />}</Field>
      </div>
      <Field label="Description" error={errors.description} hint="Plain text. A line starting with '- ' becomes a bullet.">{(p) => <textarea {...p} className="field min-h-32" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="GST rate (%)" error={errors.gstPercent}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.gstPercent} onChange={(e) => setF({ ...f, gstPercent: e.target.value })} />}</Field>
        <Field label="HSN code (optional)" error={errors.hsnCode}>{(p) => <input {...p} className="field" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} />}</Field>
        <Field label="Size chart (optional)">
          {(p) => (
            <select {...p} className="field" value={f.sizeChartId} onChange={(e) => setF({ ...f, sizeChartId: e.target.value })}>
              <option value="">None</option>
              {charts.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="label">Categories</legend>
        {cats.error && <ErrorNote message={cats.error} />}
        <div className="flex flex-wrap gap-2">
          {cats.data?.items.map((c) => {
            const on = f.categoryIds.includes(c.id);
            return (
              <label key={c.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:border-accent/50'} focus-within:outline focus-within:outline-2 focus-within:outline-accent`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => setF({ ...f, categoryIds: on ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id] })} />
                {c.parentId ? '↳ ' : ''}{c.name}{c.isActive ? '' : ' (hidden)'}
              </label>
            );
          })}
          {cats.data?.items.length === 0 && <p className="text-sm text-muted">No categories yet. Create some under Categories.</p>}
        </div>
      </fieldset>
      {error && <ErrorNote message={error} />}
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
    </form>
  );
}

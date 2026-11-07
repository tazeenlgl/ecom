'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, Card, Confirm, DataTable, Denied, ErrorNote, Field, Loading, Modal, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateTime, fromPaise, money, toPaise } from '@/lib/format';
import { useFetch } from '@/lib/hooks';
import { ProductForm } from '../product-form';

type Variant = { id: string; skuCode: string; title: string; options: Record<string, string>; status: 'active' | 'inactive'; position: number; price: { mrpPaise: number; pricePaise: number } | null };
type Media = { id: string; kind: 'image' | 'video'; url: string; altText: string | null; width: number | null; height: number | null; position: number };
type Detail = {
  product: { id: string; slug: string; title: string; description: string | null; status: 'draft' | 'published' | 'archived'; taxRateBps: number; hsnCode: string | null; sizeChartId: string | null; attributes: Record<string, string | number | boolean>; updatedAt: string };
  categoryIds: string[];
  variants: Variant[];
  media: Media[];
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { storeId, s, can } = useStore();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<Detail>(can('catalogue.read') ? s(`products/${id}`) : null);
  const [statusTo, setStatusTo] = useState<'draft' | 'published' | 'archived' | null>(null);
  const [busy, setBusy] = useState(false);
  const write = can('catalogue.write');

  if (!can('catalogue.read')) return <Denied what="view the catalogue" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { product } = data;

  return (
    <>
      <PageHeader
        title={product.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(product.status)}>{product.status}</Badge> /{product.slug} · updated {dateTime(product.updatedAt)} · <Link className="text-accent hover:underline" href={`/s/${storeId}/products`}>All products</Link></span>}
        actions={
          write && (
            <>
              {product.status !== 'published' && <button className="btn-primary" onClick={() => setStatusTo('published')}>Publish</button>}
              {product.status === 'published' && <button className="btn-secondary" onClick={() => setStatusTo('draft')}>Unpublish</button>}
              {product.status !== 'archived' && <button className="btn-danger" onClick={() => setStatusTo('archived')}>Archive</button>}
            </>
          )
        }
      />
      <div className="space-y-6">
        {write ? (
          <ProductForm
            key={product.updatedAt}
            initial={{ ...product, categoryIds: data.categoryIds }}
            submitLabel="Save changes"
            onSubmit={async (v) => {
              await api(s(`products/${id}`), { method: 'PATCH', body: v });
              toast('ok', 'Product saved.');
              await reload();
            }}
          />
        ) : (
          <Card title="Details"><p className="whitespace-pre-line text-sm">{product.description ?? 'No description.'}</p><p className="mt-3 text-xs text-muted">Your role can view but not edit products.</p></Card>
        )}
        <Variants variants={data.variants} productId={id} onChange={reload} />
        <MediaCard media={data.media} variants={data.variants} productId={id} onChange={reload} />
      </div>
      {statusTo && (
        <Confirm
          title={`${statusTo === 'published' ? 'Publish' : statusTo === 'draft' ? 'Unpublish' : 'Archive'} product`}
          body={statusTo === 'published' ? 'The product becomes visible on the storefront (it needs at least one active variant with a price to be sellable).' : statusTo === 'draft' ? 'The product is hidden from the storefront.' : 'The product is hidden from the storefront and moved to the archive.'}
          confirmLabel={statusTo === 'published' ? 'Publish' : statusTo === 'draft' ? 'Unpublish' : 'Archive'}
          danger={statusTo === 'archived'}
          busy={busy}
          onClose={() => setStatusTo(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api(s(`products/${id}/status`), { method: 'POST', body: { status: statusTo } });
              toast('ok', `Product is now ${statusTo}.`);
              setStatusTo(null);
              await reload();
            } catch (e) {
              toast('error', errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

/* ---------------- Variants and pricing ---------------- */
function Variants({ variants, productId, onChange }: { variants: Variant[]; productId: string; onChange: () => Promise<void> }) {
  const { s, can } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Variant | null>(null);
  const [history, setHistory] = useState<Variant | null>(null);
  return (
    <Card title="Variants and pricing" actions={can('catalogue.write') && <button className="btn-secondary" onClick={() => setAdding(true)}>Add variant</button>}>
      <p className="mb-3 text-xs text-muted">Stock comes from the POS (or its stand-in stock table) and is not edited here. A variant needs a SKU that already exists in the POS.</p>
      <DataTable head={['SKU', 'Variant', 'Status', 'MRP', 'Selling price', '']}>
        {variants.map((v) => (
          <tr key={v.id}>
            <td className="td font-mono text-xs">{v.skuCode}</td>
            <td className="td">{v.title}{Object.keys(v.options).length > 0 && <span className="ml-2 text-xs text-muted">{Object.entries(v.options).map(([k, x]) => `${k}: ${x}`).join(', ')}</span>}</td>
            <td className="td"><Badge tone={v.status === 'active' ? 'ok' : 'neutral'}>{v.status}</Badge></td>
            <td className="td">{money(v.price?.mrpPaise)}</td>
            <td className="td font-medium">{money(v.price?.pricePaise)}</td>
            <td className="td text-right">
              <div className="flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => setHistory(v)}>History</button>
                {(can('pricing.write') || can('catalogue.write')) && <button className="btn-secondary" onClick={() => setEditing(v)}>Edit</button>}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
      {variants.length === 0 && <p className="mt-3 text-sm text-muted">No variants yet.</p>}
      {adding && <AddVariant productId={productId} nextPosition={variants.length + 1} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChange(); }} />}
      {editing && <EditVariant variant={editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await onChange(); }} />}
      {history && <PriceHistory variant={history} path={s(`variants/${history.id}/price-history`)} onClose={() => setHistory(null)} />}
    </Card>
  );
}

const priceFields = z.object({ mrp: z.string().refine((v) => toPaise(v) !== null && toPaise(v)! > 0, 'Enter an amount in rupees.'), price: z.string().refine((v) => toPaise(v) !== null && toPaise(v)! > 0, 'Enter an amount in rupees.') }).refine((v) => (toPaise(v.price) ?? 0) <= (toPaise(v.mrp) ?? 0), { path: ['price'], message: 'The selling price cannot be above the MRP.' });

function EditVariant({ variant, onClose, onDone }: { variant: Variant; onClose: () => void; onDone: () => Promise<void> }) {
  const { s, can } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ title: variant.title, status: variant.status, mrp: fromPaise(variant.price?.mrpPaise), price: fromPaise(variant.price?.pricePaise) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Edit ${variant.skuCode}`} onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const priceChanged = f.mrp !== fromPaise(variant.price?.mrpPaise) || f.price !== fromPaise(variant.price?.pricePaise);
          const detailsChanged = f.title !== variant.title || f.status !== variant.status;
          if (priceChanged) {
            const v = validate(priceFields, f);
            setErrors(v.errors);
            if (!v.data) return;
          }
          setBusy(true);
          setError(null);
          try {
            if (detailsChanged) await api(s(`variants/${variant.id}`), { method: 'PATCH', body: { title: f.title.trim(), status: f.status } });
            if (priceChanged) await api(s(`variants/${variant.id}/price`), { method: 'PUT', body: { mrpPaise: toPaise(f.mrp), pricePaise: toPaise(f.price) } });
            toast('ok', 'Variant updated.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        {can('catalogue.write') && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Variant name">{(p) => <input {...p} className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
            <Field label="Status">{(p) => <select {...p} className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Variant['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select>}</Field>
          </div>
        )}
        {can('pricing.write') ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="MRP (₹)" error={errors.mrp}>{(p) => <input {...p} inputMode="decimal" className="field" value={f.mrp} onChange={(e) => setF({ ...f, mrp: e.target.value })} />}</Field>
            <Field label="Selling price (₹)" error={errors.price} hint="Prices include GST.">{(p) => <input {...p} inputMode="decimal" className="field" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
          </div>
        ) : (
          <p className="text-sm text-muted">Your role cannot change prices.</p>
        )}
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

const variantSchema = z.object({ skuCode: z.string().trim().min(1, 'Enter the SKU code.').max(64), title: z.string().trim().min(1, 'Enter a name such as M.').max(120), size: z.string().trim().max(40) });

function AddVariant({ productId, nextPosition, onClose, onDone }: { productId: string; nextPosition: number; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ skuCode: '', title: '', size: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add variant" onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validate(variantSchema, f);
          setErrors(v.errors);
          if (!v.data) return;
          setBusy(true);
          setError(null);
          try {
            await api(s(`products/${productId}/variants`), { method: 'POST', body: { skuCode: v.data.skuCode, title: v.data.title, options: v.data.size ? { size: v.data.size } : {}, position: nextPosition } });
            toast('ok', 'Variant added. Set its price next.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="SKU code" error={errors.skuCode} hint="Must match a SKU in the POS (or stock table).">{(p) => <input {...p} className="field" value={f.skuCode} onChange={(e) => setF({ ...f, skuCode: e.target.value })} />}</Field>
        <Field label="Variant name" error={errors.title}>{(p) => <input {...p} className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Size option (optional)" error={errors.size}>{(p) => <input {...p} className="field" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add variant'}</button></div>
      </form>
    </Modal>
  );
}

function PriceHistory({ variant, path, onClose }: { variant: Variant; path: string; onClose: () => void }) {
  const { data, error, loading } = useFetch<{ items: { id: string; mrpPaise: number; pricePaise: number; changedAt?: string; createdAt?: string; changedBy?: string | null }[] }>(path);
  return (
    <Modal title={`Price history · ${variant.skuCode}`} onClose={onClose}>
      {error && <ErrorNote message={error} />}
      {loading && <Loading />}
      {data && (data.items.length === 0 ? <p className="text-sm text-muted">No price changes recorded.</p> : (
        <ul className="divide-y divide-line text-sm">
          {data.items.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 py-2"><span>{money(h.pricePaise)} <span className="text-muted">(MRP {money(h.mrpPaise)})</span></span><span className="text-muted">{dateTime(h.changedAt ?? h.createdAt)}</span></li>
          ))}
        </ul>
      ))}
    </Modal>
  );
}

/* ---------------- Media ---------------- */
const mediaSchema = z.object({ url: z.url('Enter a full https:// address.').refine((u) => u.startsWith('https://'), 'The address must start with https://.'), altText: z.string().max(300), width: z.string().regex(/^\d*$/, 'Whole number'), height: z.string().regex(/^\d*$/, 'Whole number') });

function MediaCard({ media, variants, productId, onChange }: { media: Media[]; variants: Variant[]; productId: string; onChange: () => Promise<void> }) {
  const { s, can } = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<Media | null>(null);
  const [busy, setBusy] = useState(false);
  void variants;
  return (
    <Card title="Photos" actions={can('catalogue.write') && <button className="btn-secondary" onClick={() => setAdding(true)}>Add photo</button>}>
      <p className="mb-3 text-xs text-muted">The API stores the address of a photo hosted elsewhere (https only). It does not upload files. The first photo is the one shown in listings.</p>
      {media.length === 0 ? <p className="text-sm text-muted">No photos yet.</p> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {media.map((m) => (
            <li key={m.id} className="rounded-lg border border-line p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url.startsWith('/') ? `${process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'http://localhost:3000'}${m.url}` : m.url} alt={m.altText ?? ''} className="aspect-[3/4] w-full rounded object-cover" loading="lazy" />
              <p className="mt-1 truncate text-xs text-muted" title={m.altText ?? ''}>#{m.position} {m.altText}</p>
              {can('catalogue.write') && <button className="btn-ghost mt-1 w-full text-danger" onClick={() => setDel(m)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <Modal title="Add photo" onClose={() => setAdding(false)}>
          <AddMedia nextPosition={media.length + 1} productId={productId} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChange(); }} />
        </Modal>
      )}
      {del && (
        <Confirm
          title="Remove photo"
          body="Removes this photo from the product. The hosted file itself is not deleted."
          confirmLabel="Remove"
          danger
          busy={busy}
          onClose={() => setDel(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api(s(`media/${del.id}`), { method: 'DELETE' });
              toast('ok', 'Photo removed.');
              setDel(null);
              await onChange();
            } catch (e) {
              toast('error', errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </Card>
  );
}

function AddMedia({ productId, nextPosition, onClose, onDone }: { productId: string; nextPosition: number; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ url: '', altText: '', width: '', height: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = validate(mediaSchema, f);
        setErrors(v.errors);
        if (!v.data) return;
        setBusy(true);
        setError(null);
        try {
          await api(s(`products/${productId}/media`), { method: 'POST', body: { url: v.data.url, kind: 'image', altText: v.data.altText.trim() || null, width: v.data.width ? Number(v.data.width) : null, height: v.data.height ? Number(v.data.height) : null, position: nextPosition } });
          toast('ok', 'Photo added.');
          await onDone();
        } catch (err) {
          setError(errorText(err));
          setBusy(false);
        }
      }}
    >
      <Field label="Image address (https)" error={errors.url}>{(p) => <input {...p} className="field" placeholder="https://cdn.example.com/photo.jpg" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}</Field>
      <Field label="Description for screen readers" error={errors.altText}>{(p) => <input {...p} className="field" value={f.altText} onChange={(e) => setF({ ...f, altText: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Width (px, optional)" error={errors.width}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} />}</Field>
        <Field label="Height (px, optional)" error={errors.height}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.height} onChange={(e) => setF({ ...f, height: e.target.value })} />}</Field>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add photo'}</button></div>
    </form>
  );
}

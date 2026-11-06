'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, Confirm, DataTable, Denied, Empty, ErrorNote, Field, Loading, Modal, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateOnly, humanize, slugify } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type ContentPage = { id: string; kind: 'page' | 'policy' | 'faq'; slug: string; title: string; body: string; status: 'draft' | 'published'; position: number; updatedAt: string };
type Block = { id: string; kind: 'navigation' | 'banner' | 'homepage_section'; key: string; title: string | null; data: unknown; status: 'draft' | 'published'; position: number };

export default function ContentPageRoute() {
  const { can } = useStore();
  const [tab, setTab] = useState<'pages' | 'blocks'>('pages');
  if (!can('store.read')) return <Denied what="view content" />;
  return (
    <>
      <PageHeader title="Content" subtitle="Pages, policies, FAQs and the storefront's homepage and menu." />
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {([['pages', 'Pages, policies and FAQs'], ['blocks', 'Homepage, menu and banners']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-fg'}`}>{label}</button>
        ))}
      </div>
      {tab === 'pages' ? <Pages /> : <Blocks />}
    </>
  );
}

/* ---------------- Pages ---------------- */
function Pages() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: ContentPage[] }>(s('pages'));
  const [editing, setEditing] = useState<ContentPage | 'new' | null>(null);
  const write = can('content.write');
  return (
    <>
      <div className="mb-3 flex justify-end">{write && <button className="btn-primary" onClick={() => setEditing('new')}>New page</button>}</div>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Title', 'Type', 'Address', 'Status', 'Updated', '']} empty={data.items.length === 0 ? <Empty title="No pages yet" hint="Shipping and return policies, privacy, terms and FAQs are created here. Their content must come from you." /> : undefined}>
          {data.items.map((p) => (
            <tr key={p.id}>
              <td className="td font-medium">{p.title}</td>
              <td className="td">{humanize(p.kind)}</td>
              <td className="td text-muted">{p.kind === 'faq' ? '/faqs' : `/pages/${p.slug}`}</td>
              <td className="td"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
              <td className="td text-muted">{dateOnly(p.updatedAt)}</td>
              <td className="td text-right">{write && <button className="btn-secondary" onClick={() => setEditing(p)}>Edit</button>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {editing && <PageModal page={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

const pageSchema = z.object({ title: z.string().trim().min(1, 'Enter a title.').max(200), slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only.').max(120), position: z.string().regex(/^-?\d{1,4}$/, 'Whole number.'), body: z.string().max(100000) });

function PageModal({ page, onClose, onDone }: { page: ContentPage | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ kind: page?.kind ?? 'page', title: page?.title ?? '', slug: page?.slug ?? '', body: page?.body ?? '', status: page?.status ?? 'draft', position: String(page?.position ?? 0) });
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={page ? `Edit ${page.title}` : 'New page'} onClose={onClose} wide>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validate(pageSchema, f);
          setErrors(v.errors);
          if (!v.data) return;
          setBusy(true);
          setError(null);
          try {
            await api(page ? s(`pages/${page.id}`) : s('pages'), { method: page ? 'PATCH' : 'POST', body: { kind: f.kind, slug: v.data.slug, title: v.data.title, body: v.data.body, status: f.status, position: Number(v.data.position) } });
            toast('ok', page ? 'Page saved.' : 'Page created.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">{(p) => <select {...p} className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ContentPage['kind'] })}><option value="page">Page</option><option value="policy">Policy</option><option value="faq">FAQ entry</option></select>}</Field>
          <Field label="Status">{(p) => <select {...p} className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'draft' | 'published' })}><option value="draft">Draft (hidden)</option><option value="published">Published</option></select>}</Field>
          <Field label="Order" error={errors.position}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" error={errors.title}>{(p) => <input {...p} className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} />}</Field>
          <Field label="Address slug" error={errors.slug} hint="e.g. shipping-policy or return-policy: the storefront footer links to those two.">{(p) => <input {...p} className="field" value={f.slug} onChange={(e) => (setSlugTouched(true), setF({ ...f, slug: e.target.value }))} />}</Field>
        </div>
        <Field label="Content" error={errors.body} hint="Plain text. Blank lines separate paragraphs; '- ' starts a bullet.">{(p) => <textarea {...p} className="field min-h-56" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save page'}</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Blocks ---------------- */
function Blocks() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ items: Block[] }>(s('blocks'));
  const [editing, setEditing] = useState<Block | 'new' | null>(null);
  const [del, setDel] = useState<Block | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const write = can('content.write');
  return (
    <>
      <p className="mb-3 text-sm text-muted">Each block is structured data the storefront renders. The API validates it strictly: banner images must be https addresses.</p>
      <div className="mb-3 flex justify-end">{write && <button className="btn-primary" onClick={() => setEditing('new')}>New block</button>}</div>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <DataTable head={['Kind', 'Key', 'Summary', 'Status', 'Order', '']} empty={data.items.length === 0 ? <Empty title="No blocks yet" /> : undefined}>
          {data.items.map((b) => (
            <tr key={b.id}>
              <td className="td">{humanize(b.kind)}</td>
              <td className="td font-mono text-xs">{b.key}</td>
              <td className="td max-w-xs truncate text-muted">{summary(b)}</td>
              <td className="td"><Badge tone={statusTone(b.status)}>{b.status}</Badge></td>
              <td className="td">{b.position}</td>
              <td className="td text-right">{write && <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEditing(b)}>Edit</button><button className="btn-danger" onClick={() => setDel(b)}>Delete</button></div>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {editing && <BlockModal block={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload(); }} />}
      {del && (
        <Confirm title="Delete block" body={<>Permanently delete <b>{del.kind} / {del.key}</b> from the storefront?</>} confirmLabel="Delete" danger busy={busy} onClose={() => setDel(null)}
          onConfirm={async () => { setBusy(true); try { await api(s(`blocks/${del.id}`), { method: 'DELETE' }); toast('ok', 'Block deleted.'); setDel(null); await reload(); } catch (e) { toast('error', errorText(e)); } finally { setBusy(false); } }} />
      )}
    </>
  );
}

function summary(b: Block): string {
  const d = b.data as Record<string, unknown>;
  if (b.kind === 'navigation') return `${(d.items as unknown[] | undefined)?.length ?? 0} menu items`;
  if (b.kind === 'banner') return String(d.headline ?? (d.image as { alt?: string } | undefined)?.alt ?? (d.image as { url?: string } | undefined)?.url ?? '');
  return `${d.layout}${d.heading ? ` · ${d.heading}` : ''}`;
}

const templates: Record<Block['kind'], unknown> = {
  homepage_section: { layout: 'rich_text', heading: '', body: '' },
  banner: { image: { url: 'https://', alt: '' }, link: { label: '', href: '/shop' }, headline: '' },
  navigation: { items: [{ label: 'Shop all', href: '/shop' }] },
};

function BlockModal({ block, onClose, onDone }: { block: Block | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { s } = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<Block['kind']>(block?.kind ?? 'homepage_section');
  const [f, setF] = useState({ key: block?.key ?? '', title: block?.title ?? '', status: block?.status ?? 'draft', position: String(block?.position ?? 0), data: JSON.stringify(block?.data ?? templates.homepage_section, null, 2) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={block ? `Edit ${block.key}` : 'New block'} onClose={onClose} wide>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const er: Record<string, string> = {};
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.key)) er.key = 'Lowercase letters, numbers and hyphens only.';
          if (!/^-?\d{1,4}$/.test(f.position)) er.position = 'Whole number.';
          let data: unknown;
          try { data = JSON.parse(f.data); } catch { er.data = 'This is not valid JSON.'; }
          setErrors(er);
          if (Object.keys(er).length) return;
          setBusy(true);
          setError(null);
          try {
            await api(s('blocks'), { method: 'PUT', body: { kind, key: f.key, title: f.title.trim() || null, status: f.status, position: Number(f.position), data } });
            toast('ok', 'Block saved.');
            await onDone();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Kind" hint={block ? 'Fixed' : undefined}>{(p) => <select {...p} className="field" value={kind} disabled={Boolean(block)} onChange={(e) => { const k = e.target.value as Block['kind']; setKind(k); setF({ ...f, data: JSON.stringify(templates[k], null, 2) }); }}>{(Object.keys(templates) as Block['kind'][]).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select>}</Field>
          <Field label="Key" error={errors.key}>{(p) => <input {...p} className="field" disabled={Boolean(block)} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />}</Field>
          <Field label="Status">{(p) => <select {...p} className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'draft' | 'published' })}><option value="draft">Draft</option><option value="published">Published</option></select>}</Field>
          <Field label="Order" error={errors.position}>{(p) => <input {...p} inputMode="numeric" className="field" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />}</Field>
        </div>
        <Field label="Internal title (optional)">{(p) => <input {...p} className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Block data (JSON)" error={errors.data}>{(p) => <textarea {...p} spellCheck={false} className="field min-h-64 font-mono text-xs" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save block'}</button></div>
      </form>
    </Modal>
  );
}

'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useStore } from '@/components/store-context';
import { Badge, Card, Confirm, Denied, ErrorNote, Field, Loading, PageHeader, statusTone, useToast, validate } from '@/components/ui';
import { api, errorText } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

type StoreFull = { id: string; slug: string; name: string; status: 'active' | 'maintenance' | 'disabled'; currency: string; locale: string; timezone: string; publicSettings: { announcement?: string; layout?: { products?: { mobile: number; desktop: number }; categories?: { mobile: number; desktop: number } }; productOffer?: { code: string; text: string }; productPromo?: { title: string; text: string }; contact?: { email?: string; phone?: string }; seo?: { titleTemplate?: string; defaultDescription?: string }; logoUrl?: string; faviconUrl?: string; theme?: Record<string, string>; social?: Record<string, string> }; config: { codEnabled?: boolean; [k: string]: unknown }; posLocationRef: string | null; updatedAt: string };
type Domain = { id: string; hostname: string; isPrimary: boolean; verifiedAt: string | null; verificationRecord?: string; verificationToken?: string | null };

export default function SettingsPage() {
  const { s, can } = useStore();
  const { data, error, loading, reload } = useFetch<{ store: StoreFull }>(can('store.read') ? s() : null);
  if (!can('store.read')) return <Denied what="view store settings" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <>
      <PageHeader title="Store settings" subtitle={`${data.store.name} · last updated ${dateTime(data.store.updatedAt)}`} />
      <div className="space-y-6">
        <Profile store={data.store} onSaved={reload} />
        <Domains />
        <Payments />
      </div>
    </>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  announcement: z.string().max(300),
  offerCode: z.string().trim().refine((v) => v === '' || /^[A-Za-z0-9_-]{1,32}$/.test(v), 'Letters, numbers, - and _ only (max 32).'),
  offerText: z.string().trim().max(120),
  promoTitle: z.string().trim().max(60),
  promoText: z.string().trim().max(160),
  email: z.string().trim().refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email.'),
  phone: z.string().trim().max(32),
  description: z.string().max(500),
  titleTemplate: z.string().max(120).refine((v) => v === '' || v.includes('%s'), 'Must contain %s where the page title goes.'),
});

function Profile({ store, onSaved }: { store: StoreFull; onSaved: () => Promise<void> }) {
  const { s, can } = useStore();
  const toast = useToast();
  const ps = store.publicSettings ?? {};
  const [f, setF] = useState({ name: store.name, announcement: ps.announcement ?? '', offerCode: ps.productOffer?.code ?? '', offerText: ps.productOffer?.text ?? '', prodMobile: String(ps.layout?.products?.mobile ?? 2), prodDesktop: String(ps.layout?.products?.desktop ?? 4), catMobile: String(ps.layout?.categories?.mobile ?? 2), catDesktop: String(ps.layout?.categories?.desktop ?? 5), promoTitle: ps.productPromo?.title ?? '', promoText: ps.productPromo?.text ?? '', email: ps.contact?.email ?? '', phone: ps.contact?.phone ?? '', description: ps.seo?.defaultDescription ?? '', titleTemplate: ps.seo?.titleTemplate ?? '', codEnabled: store.config?.codEnabled !== false, status: store.status });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const manage = can('store.settings.manage');

  const save = async () => {
    const v = validate(schema, f);
    setErrors(v.errors);
    if (!v.data) return;
    if (Boolean(v.data.offerCode) !== Boolean(v.data.offerText)) {
      setErrors({ ...v.errors, [v.data.offerCode ? 'offerText' : 'offerCode']: 'Fill in both the code and the text, or leave both empty.' });
      return;
    }
    if (Boolean(v.data.promoTitle) !== Boolean(v.data.promoText)) {
      setErrors({ ...v.errors, [v.data.promoTitle ? 'promoText' : 'promoTitle']: 'Fill in both the title and the text, or leave both empty.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const publicSettings = {
        ...ps,
        announcement: v.data.announcement || undefined,
        layout: {
          products: { mobile: Number(f.prodMobile), desktop: Number(f.prodDesktop) },
          categories: { mobile: Number(f.catMobile), desktop: Number(f.catDesktop) },
        },
        productPromo: v.data.promoTitle ? { title: v.data.promoTitle, text: v.data.promoText } : undefined,
        productOffer: v.data.offerCode ? { code: v.data.offerCode.toUpperCase(), text: v.data.offerText } : undefined,
        contact: { ...ps.contact, email: v.data.email || undefined, phone: v.data.phone || undefined },
        seo: { ...ps.seo, defaultDescription: v.data.description || undefined, titleTemplate: v.data.titleTemplate || undefined },
      };
      await api(s(), { method: 'PATCH', body: { name: v.data.name, publicSettings, config: { ...store.config, codEnabled: f.codEnabled }, ...(f.status !== store.status ? { status: f.status } : {}) } });
      toast('ok', 'Store settings saved.');
      setConfirmStatus(false);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
      setConfirmStatus(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Profile and storefront">
      <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (f.status !== store.status) setConfirmStatus(true); else void save(); }}>
        <fieldset disabled={!manage} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store name" error={errors.name}>{(p) => <input {...p} className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Store status" hint="Maintenance and disabled stop the storefront from taking orders. Changing status needs the platform permission.">
              {(p) => <select {...p} className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StoreFull['status'] })}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="disabled">Disabled</option></select>}
            </Field>
          </div>
          <Field label="Announcement bar" error={errors.announcement} hint="Shown at the top of the storefront. Leave empty to hide it.">{(p) => <input {...p} className="field" value={f.announcement} onChange={(e) => setF({ ...f, announcement: e.target.value })} />}</Field>
          <fieldset className="rounded-xl border border-line p-4">
            <legend className="label px-1">Cards per row</legend>
            <p className="mb-3 text-xs text-muted">How many cards show side by side on the storefront. Product rows and grids use the product numbers; the category slider uses the category numbers. If a store has fewer categories than the number set, they simply fill the row. Tablets show a number in between.</p>
            <div className="grid gap-4 sm:grid-cols-4">
              {([['prodMobile', 'Products on phone', [1, 2, 3]], ['prodDesktop', 'Products on computer', [2, 3, 4, 5, 6]], ['catMobile', 'Categories on phone', [1, 2, 3]], ['catDesktop', 'Categories on computer', [2, 3, 4, 5, 6]]] as const).map(([key, label, options]) => (
                <Field key={key} label={label}>{(p) => <select {...p} className="field" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>{options.map((n) => <option key={n} value={n}>{n}</option>)}</select>}</Field>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Product page offer code" error={errors.offerCode} hint="Shown on product pages under “Where’s the discount?”. It must be a real coupon; checkout still checks it.">{(p) => <input {...p} className="field uppercase" value={f.offerCode} onChange={(e) => setF({ ...f, offerCode: e.target.value })} />}</Field>
            <Field label="Offer text" error={errors.offerText} hint="e.g. Buy 2, get ₹500 off. Leave both empty to hide.">{(p) => <input {...p} className="field" value={f.offerText} onChange={(e) => setF({ ...f, offerText: e.target.value })} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Product page note title" error={errors.promoTitle} hint="e.g. Limited time offer">{(p) => <input {...p} className="field" value={f.promoTitle} onChange={(e) => setF({ ...f, promoTitle: e.target.value })} />}</Field>
            <Field label="Product page note text" error={errors.promoText} hint="Text only; it does not change prices. Leave both empty to hide.">{(p) => <input {...p} className="field" value={f.promoText} onChange={(e) => setF({ ...f, promoText: e.target.value })} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact email" error={errors.email}>{(p) => <input {...p} className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <Field label="Contact phone" error={errors.phone}>{(p) => <input {...p} className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          </div>
          <Field label="Default description (SEO)" error={errors.description}>{(p) => <textarea {...p} className="field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <Field label="Page title template" error={errors.titleTemplate} hint="e.g. %s | TAZEEN">{(p) => <input {...p} className="field" value={f.titleTemplate} onChange={(e) => setF({ ...f, titleTemplate: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.codEnabled} onChange={(e) => setF({ ...f, codEnabled: e.target.checked })} /> Allow cash on delivery (also needs a zone that allows it)</label>
        </fieldset>
        <p className="text-xs text-muted">Currency ({store.currency}), locale ({store.locale}), timezone ({store.timezone}), theme colours and the logo are not editable here. Theme and logo live in the store&apos;s public settings and need an https logo address.</p>
        {error && <ErrorNote message={error} />}
        {manage ? <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div> : <p className="text-sm text-muted">Your role can view but not change these settings.</p>}
      </form>
      {confirmStatus && (
        <Confirm title="Change store status" body={<>Set <b>{store.name}</b> to <b>{f.status}</b>? {f.status !== 'active' ? 'Customers will no longer be able to shop.' : ''}</>} confirmLabel="Change status" danger={f.status !== 'active'} busy={busy} onClose={() => setConfirmStatus(false)} onConfirm={save} />
      )}
    </Card>
  );
}

function Domains() {
  const { s, can } = useStore();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: Domain[] }>(s('domains'));
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const manage = can('platform.domains.manage');
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast('ok', ok); await reload(); } catch (e) { toast('error', errorText(e)); } finally { setBusy(null); }
  };
  return (
    <Card title="Domains">
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <ul className="divide-y divide-line text-sm">
          {data.items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{d.hostname} {d.isPrimary && <Badge tone="accent">Primary</Badge>} <Badge tone={statusTone(d.verifiedAt ? 'verified' : 'pending')}>{d.verifiedAt ? 'Verified' : 'Not verified'}</Badge></p>
                {!d.verifiedAt && d.verificationRecord && <p className="mt-1 text-xs text-muted">Add a DNS TXT record at <span className="font-mono">{d.verificationRecord}</span>{d.verificationToken ? <> with value <span className="font-mono">{d.verificationToken}</span></> : null}, then verify.</p>}
              </div>
              {manage && (
                <div className="flex gap-2">
                  {!d.verifiedAt && <button className="btn-secondary" disabled={busy === d.id} onClick={() => act(d.id, () => api(s(`domains/${d.id}/verify`), { method: 'POST', body: {} }), 'Domain verified.')}>Verify</button>}
                  {d.verifiedAt && !d.isPrimary && <button className="btn-secondary" disabled={busy === d.id} onClick={() => act(d.id, () => api(s(`domains/${d.id}/primary`), { method: 'POST' }), 'Primary domain changed.')}>Make primary</button>}
                  {!d.isPrimary && <button className="btn-danger" disabled={busy === d.id} onClick={() => confirm(`Remove ${d.hostname}?`) && act(d.id, () => api(s(`domains/${d.id}`), { method: 'DELETE' }), 'Domain removed.')}>Remove</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage ? (
        <form className="mt-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host.trim())) return setFormError('Enter a host name such as shop.example.com.'); setFormError(null); await act('add', () => api(s('domains'), { method: 'POST', body: { hostname: host.trim().toLowerCase() } }), 'Domain added. Publish the TXT record, then verify.'); setHost(''); }}>
          <label htmlFor="newhost" className="sr-only">New domain</label>
          <input id="newhost" className="field max-w-sm" placeholder="shop.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
          <button className="btn-secondary" disabled={busy === 'add'}>Add domain</button>
        </form>
      ) : <p className="mt-3 text-xs text-muted">Managing domains needs the platform domains permission.</p>}
      {formError && <p className="mt-2 text-sm text-danger" role="alert">{formError}</p>}
    </Card>
  );
}

function Payments() {
  const { s, can } = useStore();
  const { data, error } = useFetch<{ paytm: { configured: boolean; enabled: boolean; merchantKeySet: boolean; merchantId?: string | null; environment?: string; blockedReason?: 'staging_in_production' | 'production_not_enabled' | null } }>(can('store.settings.manage') ? s('payment-gateways/paytm') : null);
  return (
    <Card title="Payment gateway (Paytm)">
      {!can('store.settings.manage') ? <p className="text-sm text-muted">Payment settings need the store settings permission.</p> : error ? <ErrorNote message={error} /> : !data ? <Loading /> : (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Configured</dt><dd><Badge tone={data.paytm.configured ? 'ok' : 'neutral'}>{data.paytm.configured ? 'Yes' : 'No'}</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-muted">Enabled</dt><dd><Badge tone={data.paytm.enabled ? 'ok' : 'neutral'}>{data.paytm.enabled ? 'Yes' : 'No'}</Badge></dd></div>
          {data.paytm.configured && <div className="flex justify-between"><dt className="text-muted">Merchant ID</dt><dd className="font-mono text-xs">{data.paytm.merchantId ?? '—'}</dd></div>}
          {data.paytm.configured && <div className="flex justify-between"><dt className="text-muted">Environment</dt><dd>{data.paytm.environment ?? '—'}</dd></div>}
          {data.paytm.blockedReason && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{data.paytm.blockedReason === 'staging_in_production' ? 'This staging configuration is not used: Paytm staging is refused in a production deployment.' : 'This production configuration is not used: the deployment has not enabled Paytm production.'}</p>}
          <div className="flex justify-between"><dt className="text-muted">Merchant key stored</dt><dd>{data.paytm.merchantKeySet ? 'Yes (hidden)' : 'No'}</dd></div>
          <p className="pt-2 text-xs text-muted">Credentials are write-only: the merchant key is encrypted at rest and never shown. Entering or rotating Paytm credentials is not available in this release; do not enter live credentials in a local environment.</p>
        </dl>
      )}
    </Card>
  );
}

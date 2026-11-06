'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';

/* ---------- Toasts (truthful: callers only toast after the API call resolved) ---------- */
type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-lg border bg-surface px-4 py-3 text-sm shadow-lg ${t.kind === 'ok' ? 'border-ok/40' : 'border-danger/40'}`}>
            <span className={`mr-2 font-semibold ${t.kind === 'ok' ? 'text-ok' : 'text-danger'}`}>{t.kind === 'ok' ? 'Saved' : 'Failed'}</span>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Layout bits ---------- */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const tones: Record<string, string> = {
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-fg/5 text-muted',
};
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function statusTone(s: string): keyof typeof tones {
  if (['published', 'active', 'completed', 'succeeded', 'delivered', 'synced', 'paid', 'captured', 'verified'].includes(s)) return 'ok';
  if (['draft', 'pending', 'pending_payment', 'queued', 'running', 'processing', 'confirmed', 'maintenance', 'approved', 'in_progress', 'requested'].includes(s)) return 'warn';
  if (['cancelled', 'failed', 'dead', 'disabled', 'rejected', 'manual_required', 'archived'].includes(s)) return 'danger';
  return 'neutral';
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <p className="py-10 text-center text-sm text-muted" role="status">{text}</p>;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
      {message}
      {onRetry && (
        <button className="ml-3 underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Denied({ what }: { what: string }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <p className="font-display text-2xl">Access denied</p>
      <p className="mt-2 text-sm text-muted">Your role does not include permission to {what}.</p>
    </div>
  );
}

export function DataTable({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-line bg-bg/60">
          <tr>
            {head.map((h) => (
              <th key={h} className="th" scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="border-t border-line p-3 text-center">
      <button className="btn-secondary" onClick={onClick} disabled={loading}>
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

/* ---------- Form controls ---------- */
export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: (p: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const describedBy = [error ? `${id}-e` : '', hint ? `${id}-h` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={`${id}-h`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Runs a zod schema and returns a map of field -> first message (empty when valid). */
export function validate<T extends z.ZodType>(schema: T, value: unknown): { data?: z.output<T>; errors: Record<string, string> } {
  const r = schema.safeParse(value);
  if (r.success) return { data: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { errors };
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea')];
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/40 p-4 sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} shadow-xl`}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Confirm dialog for destructive or irreversible actions. */
export function Confirm({ title, body, confirmLabel, danger, busy, onConfirm, onClose }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export const inputProps = (p: object) => p as React.InputHTMLAttributes<HTMLInputElement>;

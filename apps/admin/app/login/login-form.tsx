'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Field, validate } from '@/components/ui';

const schema = z.object({ email: z.string().trim().min(3, 'Enter your email.').max(200), password: z.string().min(1, 'Enter your password.').max(200) });

export function LoginForm() {
  const [f, setF] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      noValidate
      className="mt-6 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = validate(schema, f);
        setErrors(v.errors);
        if (!v.data) return;
        setBusy(true);
        setError(null);
        try {
          const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v.data), credentials: 'same-origin' });
          const body = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
          if (!res.ok) throw new Error(body?.error?.message ?? 'Sign-in failed.');
          window.location.assign('/');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Sign-in failed.');
          setBusy(false);
        }
      }}
    >
      <Field label="Email" error={errors.email}>
        {(p) => <input {...p} type="email" className="field" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
      </Field>
      <Field label="Password" error={errors.password}>
        {(p) => <input {...p} type="password" className="field" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
      </Field>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button className="btn-primary w-full py-2.5" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

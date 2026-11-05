'use client';

import { useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';

export function ProfileForm({ name: initialName, email: initialEmail }: { name: string; email: string }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <form
      className="grid max-w-xl gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus(null);
        try {
          await sf('me', { method: 'PATCH', body: { ...(name ? { name } : {}), email: email || null } });
          setStatus('Saved.');
        } catch (err) {
          setStatus(errorMessage(err));
        }
      }}
    >
      <label><span className="label">Name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <label><span className="label">Email</span><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <div className="flex items-center gap-4 sm:col-span-2">
        <button className="btn-primary">Save</button>
        {status && <span className="text-sm text-muted" role="status">{status}</span>}
      </div>
    </form>
  );
}

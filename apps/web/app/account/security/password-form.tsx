'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';
import { ApiError } from '@/lib/errors';
import { checkNewPassword } from '@/lib/password';

type Problem = { field: 'current' | 'password' | 'confirm' | 'form'; message: string };

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sending = useRef(false);

  const fail = (field: Problem['field']) => (problem?.field === field ? problem.message : null);
  const aria = (field: Problem['field']) => ({ 'aria-invalid': fail(field) ? true : undefined, 'aria-describedby': fail(field) ? `pw-${field}-error` : undefined });
  const err = (field: Problem['field']) => fail(field) && <p id={`pw-${field}-error`} className="mt-1.5 text-xs text-sale" role="alert">{fail(field)}</p>;

  return (
    <form
      noValidate
      className="grid max-w-md gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending.current) return;
        setDone(null);
        if (hasPassword && !current) return setProblem({ field: 'current', message: 'Enter your current password.' });
        const bad = checkNewPassword(password, confirm);
        if (bad) return setProblem(bad);
        setProblem(null);
        sending.current = true;
        setBusy(true);
        try {
          await sf('me/password', { method: 'PUT', body: { ...(hasPassword ? { currentPassword: current } : {}), newPassword: password } });
          setDone(hasPassword ? 'Password changed. Your other devices have been signed out.' : 'Password set. You can now sign in with it.');
          setCurrent('');
          setPassword('');
          setConfirm('');
          router.refresh(); // re-read hasPassword so the page switches from "set" to "change"
        } catch (e2) {
          // The API names the field for a wrong current password; this does not sign you out.
          const field = e2 instanceof ApiError && (e2.details as { field?: string } | undefined)?.field === 'currentPassword' ? 'current' : 'form';
          setProblem({ field, message: errorMessage(e2) });
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      {hasPassword && (
        <div>
          <label className="label" htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" className="field" autoComplete="current-password" value={current} disabled={busy} onChange={(e) => setCurrent(e.target.value)} {...aria('current')} />
          {err('current')}
        </div>
      )}
      <div>
        <label className="label" htmlFor="pw-password">New password</label>
        <input id="pw-password" type="password" className="field" autoComplete="new-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} {...aria('password')} />
        {err('password') || <p className="mt-1.5 text-xs text-muted">At least 8 characters.</p>}
      </div>
      <div>
        <label className="label" htmlFor="pw-confirm">Confirm new password</label>
        <input id="pw-confirm" type="password" className="field" autoComplete="new-password" value={confirm} disabled={busy} onChange={(e) => setConfirm(e.target.value)} {...aria('confirm')} />
        {err('confirm')}
      </div>
      {fail('form') && <p className="text-sm text-sale" role="alert">{fail('form')}</p>}
      <div className="flex items-center gap-4">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}</button>
        {done && <span className="text-sm text-muted" role="status">{done}</span>}
      </div>
    </form>
  );
}

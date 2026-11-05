'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';
import { checkNewPassword, isOtpCode } from '@/lib/password';

type Challenge = { challengeId: string; expiresAt: string; resendAfterSeconds: number };

/** Mobile OTP sign-in (with password as an alternative). Tokens become httpOnly cookies in the BFF. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'otp' | 'password' | 'reset'>('otp');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<{ field: 'code' | 'password' | 'confirm'; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // WebOTP: on supporting Android browsers the SMS code fills itself in.
  useEffect(() => {
    if (!challenge || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const otp = (cred as unknown as { code?: string } | null)?.code;
        if (otp) setCode(otp);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [challenge]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      const c = await sf<Challenge>('auth/otp/request', { method: 'POST', body: { phone, purpose: 'login' } });
      setChallenge(c);
      setWait(c.resendAfterSeconds);
      setTimeout(() => codeRef.current?.focus(), 100);
    });

  const verify = () =>
    run(async () => {
      await sf('auth/otp/verify', { method: 'POST', body: { challengeId: challenge!.challengeId, phone, code } });
      onSignedIn();
    });

  const passwordLogin = () =>
    run(async () => {
      await sf('auth/password/login', { method: 'POST', body: { phone, password } });
      onSignedIn();
    });

  // Forgot password. The API sends a code only to numbers that have a password and answers the same either way,
  // so nothing here says whether the number has an account.
  const requestReset = () =>
    run(async () => {
      const c = await sf<Challenge>('auth/otp/request', { method: 'POST', body: { phone, purpose: 'reset_password' } });
      setChallenge(c);
      setCode('');
      setWait(c.resendAfterSeconds);
      setTimeout(() => codeRef.current?.focus(), 100);
    });

  const resetPassword = () => {
    if (!isOtpCode(code)) return setFieldError({ field: 'code', message: 'Enter the 6-digit code.' });
    const bad = checkNewPassword(newPassword, confirm);
    if (bad) return setFieldError(bad);
    setFieldError(null);
    return run(async () => {
      await sf('auth/password/reset', { method: 'POST', body: { challengeId: challenge!.challengeId, phone, code, newPassword } });
      // Every session was signed out by the reset; go back to password sign-in with the number kept.
      setChallenge(null);
      setCode('');
      setNewPassword('');
      setConfirm('');
      setPassword('');
      setMode('password');
      setNotice('Your password is updated. Sign in with it below.');
    });
  };

  const fieldProps = (field: 'code' | 'password' | 'confirm') => ({
    'aria-invalid': fieldError?.field === field ? true : undefined,
    'aria-describedby': fieldError?.field === field ? `reset-${field}-error` : undefined,
  });
  const fieldMessage = (field: 'code' | 'password' | 'confirm') =>
    fieldError?.field === field && <p id={`reset-${field}-error`} className="mt-1.5 text-xs text-sale" role="alert">{fieldError.message}</p>;

  return (
    <div className="w-full">
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'otp' && !challenge && (
          <motion.form key="phone" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={(e) => (e.preventDefault(), requestCode())} className="space-y-4">
            <PhoneField phone={phone} setPhone={setPhone} />
            <button className="btn-primary w-full" disabled={busy || phone.length !== 10}>
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </motion.form>
        )}
        {mode === 'otp' && challenge && (
          <motion.form key="code" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={(e) => (e.preventDefault(), verify())} className="space-y-4">
            <p className="text-sm text-muted">
              We sent a code to +91 {phone}.{' '}
              <button type="button" className="underline" onClick={() => (setChallenge(null), setCode(''))}>
                Change
              </button>
            </p>
            <div>
              <label className="label" htmlFor="otp">One-time code</label>
              <input
                ref={codeRef}
                id="otp"
                className="field text-center font-mono text-2xl tracking-[0.6em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button className="btn-primary w-full" disabled={busy || code.length < 4}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button type="button" className="w-full text-sm text-muted disabled:opacity-50" disabled={wait > 0 || busy} onClick={requestCode}>
              {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            </button>
          </motion.form>
        )}
        {mode === 'password' && (
          <motion.form key="pw" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={(e) => (e.preventDefault(), passwordLogin())} className="space-y-4">
            <PhoneField phone={phone} setPhone={setPhone} />
            <div>
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn-primary w-full" disabled={busy || phone.length !== 10 || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="w-full text-center text-sm text-muted underline-offset-4 hover:underline" onClick={() => (setMode('reset'), setChallenge(null), setError(null), setNotice(null), setFieldError(null))}>
              Forgot password?
            </button>
          </motion.form>
        )}
        {mode === 'reset' && !challenge && (
          <motion.form key="reset-phone" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={(e) => (e.preventDefault(), requestReset())} className="space-y-4">
            <p className="text-sm text-muted">Enter your mobile number and we’ll send a code to reset your password.</p>
            <PhoneField phone={phone} setPhone={setPhone} />
            <button className="btn-primary w-full" disabled={busy || phone.length !== 10}>
              {busy ? 'Sending code…' : 'Send reset code'}
            </button>
          </motion.form>
        )}
        {mode === 'reset' && challenge && (
          <motion.form key="reset-code" noValidate initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} onSubmit={(e) => (e.preventDefault(), resetPassword())} className="space-y-4">
            <p className="text-sm text-muted">
              If +91 {phone} has a password, we’ve sent it a code. No password on this account? Go back and sign in with a one-time code.{' '}
              <button type="button" className="underline" onClick={() => (setChallenge(null), setCode(''), setFieldError(null))}>Change number</button>
            </p>
            <div>
              <label className="label" htmlFor="reset-code">Reset code</label>
              <input
                ref={codeRef}
                id="reset-code"
                className="field text-center font-mono text-2xl tracking-[0.6em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                {...fieldProps('code')}
              />
              {fieldMessage('code')}
            </div>
            <div>
              <label className="label" htmlFor="reset-password">New password</label>
              <input id="reset-password" type="password" className="field" autoComplete="new-password" value={newPassword} disabled={busy} onChange={(e) => setNewPassword(e.target.value)} {...fieldProps('password')} />
              {fieldMessage('password') || <p className="mt-1.5 text-xs text-muted">At least 8 characters.</p>}
            </div>
            <div>
              <label className="label" htmlFor="reset-confirm">Confirm new password</label>
              <input id="reset-confirm" type="password" className="field" autoComplete="new-password" value={confirm} disabled={busy} onChange={(e) => setConfirm(e.target.value)} {...fieldProps('confirm')} />
              {fieldMessage('confirm')}
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
            <button type="button" className="w-full text-sm text-muted disabled:opacity-50" disabled={wait > 0 || busy} onClick={requestReset}>
              {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {notice && !error && <p className="mt-3 text-sm text-muted" role="status">{notice}</p>}
      {error && <p className="mt-3 text-sm text-sale" role="alert">{error}</p>}

      <button
        type="button"
        className="mt-6 w-full text-center text-sm text-muted underline-offset-4 hover:underline"
        onClick={() => {
          // From "reset" the way back is password sign-in; otherwise the two sign-in methods swap.
          setMode((m) => (m === 'otp' ? 'password' : m === 'reset' ? 'password' : 'otp'));
          setError(null);
          setNotice(null);
          setFieldError(null);
          setChallenge(null);
        }}
      >
        {mode === 'otp' ? 'Use password instead' : mode === 'reset' ? 'Back to sign in' : 'Use a one-time code instead'}
      </button>
    </div>
  );
}

function PhoneField({ phone, setPhone }: { phone: string; setPhone: (v: string) => void }) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && phone.length > 0 && phone.length !== 10;
  return (
    <div>
      <label className="label" htmlFor="phone">Mobile number</label>
      <div className={`flex items-center rounded-xl border bg-surface focus-within:ring-4 focus-within:ring-accent/15 ${invalid ? 'border-sale' : 'border-line focus-within:border-accent'}`}>
        <span className="pl-4 text-sm text-muted" aria-hidden="true">+91</span>
        <input
          id="phone"
          className="w-full bg-transparent px-3 py-3 text-sm outline-none"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="10-digit mobile number"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'phone-error' : undefined}
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          onBlur={() => setTouched(true)}
        />
      </div>
      {invalid && <p id="phone-error" className="mt-1.5 text-xs text-sale">Enter all 10 digits of your mobile number.</p>}
    </div>
  );
}

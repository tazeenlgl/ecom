'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, sf } from '@/lib/client-api';

type Challenge = { challengeId: string; expiresAt: string; resendAfterSeconds: number };

/** Mobile OTP sign-in (with password as an alternative). Tokens become httpOnly cookies in the BFF. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
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

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
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
          </motion.form>
        )}
      </AnimatePresence>

      {error && <p className="mt-3 text-sm text-sale" role="alert">{error}</p>}

      <button
        type="button"
        className="mt-6 w-full text-center text-sm text-muted underline-offset-4 hover:underline"
        onClick={() => {
          setMode((m) => (m === 'otp' ? 'password' : 'otp'));
          setError(null);
          setChallenge(null);
        }}
      >
        {mode === 'otp' ? 'Use password instead' : 'Use a one-time code instead'}
      </button>
    </div>
  );
}

function PhoneField({ phone, setPhone }: { phone: string; setPhone: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor="phone">Mobile number</label>
      <div className="flex items-center rounded-xl border border-line bg-surface focus-within:border-fg/60 focus-within:ring-4 focus-within:ring-fg/5">
        <span className="pl-4 text-sm text-muted">+91</span>
        <input
          id="phone"
          className="w-full bg-transparent px-3 py-3 text-sm outline-none"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="10-digit mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        />
      </div>
    </div>
  );
}

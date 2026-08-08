'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordForm() {
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery session in the URL fragment and the client
    // exchanges it automatically. Wait for that before showing the form,
    // otherwise updateUser would fail with no session.
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bdm-card p-6 text-center">
        <h1 className="bdm-h2">Password updated</h1>
        <p className="bdm-sub mt-2">You&apos;re signed in.</p>
        <Link href="/command/portfolio" className="bdm-btn-gold mt-5">Continue</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bdm-card p-6">
      <h1 className="bdm-h2">Set a new password</h1>

      {!ready && (
        <p className="mt-3 rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-sm text-ink">
          Open this page from the link in your email. If you came here directly, request a new reset
          link from the <Link href="/auth/sign-in" className="font-semibold underline">sign-in page</Link>.
        </p>
      )}

      <div className="mt-4">
        <label className="bdm-label" htmlFor="new-password">New password</label>
        <input id="new-password" type="password" className="bdm-input" minLength={8} required
               autoComplete="new-password" value={password}
               onChange={(e) => setPassword(e.target.value)} disabled={!ready} />
        <span className="bdm-hint">At least 8 characters.</span>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <button type="submit" className="bdm-btn-primary mt-5 w-full" disabled={busy || !ready}>
        {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}

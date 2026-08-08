'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'sign-in' | 'sign-up';

export default function AuthForm({ initialMode, next }: { initialMode: Mode; next?: string }) {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'sign-up') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;

        // Supabase deliberately does not reveal that an address is already
        // registered — it returns a user with an EMPTY identities array and
        // sends no email. Without this check the UI tells an existing user
        // to "check your email" for a message that will never arrive.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setMode('sign-in');
          setNotice('You already have an account with this email. Enter your password to sign in.');
          setBusy(false);
          return;
        }

        // The profile row is created by the `handle_new_user` trigger.
        // The client must not write it: `id` and the billing columns are
        // no longer client-writable.
        if (!data.session) {
          setNotice(
            'Almost there — check your email and click the confirmation link. It can take a minute to arrive.'
          );
          setBusy(false);
          return;
        }
        window.location.href = next || '/onboarding';
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        if (/invalid login credentials/i.test(signInError.message)) {
          throw new Error(
            'That email and password do not match. If you signed up but never set a password, use "Forgot password" below.'
          );
        }
        throw signInError;
      }
      // Portfolio forwards to onboarding when there is no business yet.
      window.location.href = next || '/command/portfolio';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.');
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!email) {
      setError('Enter your email first.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      if (resetError) throw resetError;
      setNotice('If that email has an account, a reset link is on its way.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a reset link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bdm-card p-6">
      <div className="mb-5 flex rounded-pill border border-gold-line bg-white/60 p-1" role="tablist">
        {(['sign-in', 'sign-up'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(null); setNotice(null); }}
            className={`flex-1 rounded-pill px-3 py-2 text-sm font-semibold transition-colors ${
              mode === m ? 'bg-ink text-cream' : 'text-muted hover:text-ink'
            }`}
          >
            {m === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="bdm-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="bdm-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="bdm-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="bdm-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
          {mode === 'sign-up' && <span className="bdm-hint">At least 8 characters.</span>}
        </div>

        {error && (
          <p role="alert" className="rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-sm text-ink">
            {notice}
          </p>
        )}

        <button type="submit" className="bdm-btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>

        {mode === 'sign-in' && (
          <button type="button" onClick={sendReset} disabled={busy}
                  className="w-full text-center text-[13px] font-semibold text-muted hover:text-ink">
            Forgot password? Email me a reset link
          </button>
        )}
      </form>
    </div>
  );
}

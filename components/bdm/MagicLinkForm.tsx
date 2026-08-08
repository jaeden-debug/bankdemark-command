'use client';

// ============================================================
// MAGIC-LINK SIGN IN
//
// One field, one button. No password to choose, forget or leak.
// The user never sees a Supabase-branded surface: the request goes to
// our own route, and the link returns to our own callback.
// ============================================================

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type State = 'idle' | 'sending' | 'sent' | 'error';

export default function MagicLinkForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.');
      setState('error');
      return;
    }

    setState('sending');
    setError(null);

    try {
      // The redirect target is resolved SERVER-side so a client can
      // never point the magic link at another origin.
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not send the link.');
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="bdm-card p-7 text-center" role="status">
        <div
          aria-hidden
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-pill bg-gold-tint text-xl text-gold-dark"
        >
          ✓
        </div>
        <h2 className="bdm-h2">Check your email</h2>
        <p className="bdm-sub mx-auto mt-2 max-w-xs">
          We sent a sign-in link to <strong className="text-ink">{email}</strong>. It works once and
          expires in an hour.
        </p>
        <button
          type="button"
          onClick={() => {
            setState('idle');
            setError(null);
          }}
          className="bdm-btn-ghost bdm-btn-sm mt-4"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bdm-card p-7">
      <h1 className="bdm-h1">Sign in</h1>
      <p className="bdm-sub mt-1.5">
        Enter your email and we&rsquo;ll send you a link. No password to remember.
      </p>

      <div className="mt-5">
        <label className="bdm-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          className={`bdm-input ${state === 'error' ? 'bdm-input-error' : ''}`}
          placeholder="you@yourbusiness.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === 'error') setState('idle');
          }}
          aria-invalid={state === 'error'}
          aria-describedby={error ? 'email-error' : undefined}
        />
        {error && (
          <p id="email-error" role="alert" className="mt-1.5 text-sm font-semibold text-negative">
            {error}
          </p>
        )}
      </div>

      <button type="submit" disabled={state === 'sending'} className="bdm-btn-gold mt-4 w-full">
        {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
      </button>

      <p className="bdm-hint mt-4 text-center">
        New here? The same link creates your account.
      </p>
    </form>
  );
}

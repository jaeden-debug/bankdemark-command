'use client';

import { useState } from 'react';
import type { PlanId } from '@/lib/config/plans';

export default function PricingActions({ planId }: { planId: PlanId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (planId === 'free') {
    return (
      <a href="/auth/sign-in" className="bdm-btn-secondary w-full">
        Start free
      </a>
    );
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const json = await res.json();
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?next=/pricing`;
        return;
      }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Could not start checkout.');
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={checkout} disabled={busy} className="bdm-btn-gold w-full">
        {busy ? 'Opening…' : 'Choose plan'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-negative">{error}</p>
      )}
    </>
  );
}

'use client';

// ============================================================
// DRAFT WITH ZYLX
//
// Produces a DRAFT and takes the user straight to the editor. Zylx
// never issues and never sends — the user does both.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const EXAMPLES = [
  'Invoice Lisa Travel Design $1,500 for website work, plus tax, due in 14 days',
  'Create an invoice for John for 5 hours consulting at $125/hour',
  'Bill Acme Corp $2,400 for the September retainer, net 30',
];

export default function AiInvoiceDraft({
  businessId,
  remaining,
}: {
  businessId: string;
  /** null = unlimited. */
  remaining: number | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);

  const exhausted = remaining !== null && remaining <= 0;

  async function draft(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setClarify(null);
    try {
      const res = await fetch('/api/invoices/draft-with-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, prompt: prompt.trim() }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? 'Could not draft that invoice.');
      if (!json.ok && json.needsClarification) {
        setClarify(json.needsClarification);
        setBusy(false);
        return;
      }

      const params = json.warnings?.length
        ? `?notice=${encodeURIComponent(json.warnings.join(' '))}`
        : '';
      router.push(`/b/${businessId}/invoices/${json.invoice.id}/edit${params}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={draft} className="bdm-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="bdm-h2">Draft with Zylx</h2>
        {remaining !== null && (
          <span className={remaining > 0 ? 'bdm-badge-neutral' : 'bdm-badge-caution'}>
            {remaining} left this month
          </span>
        )}
      </div>
      <p className="bdm-sub mt-1 text-xs">
        Describe the invoice in your own words. Zylx prepares a draft — you review, edit and issue it.
      </p>

      <label className="sr-only" htmlFor="ai-prompt">Describe the invoice</label>
      <textarea
        id="ai-prompt"
        className="bdm-textarea mt-3"
        rows={3}
        disabled={exhausted}
        placeholder={EXAMPLES[0]}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {!exhausted && (
        <div className="bdm-scroll-x mt-2 flex gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="whitespace-nowrap rounded-pill border border-gold-line bg-white/70 px-3 py-1.5 text-[12px] text-muted hover:text-ink"
            >
              {ex.length > 46 ? `${ex.slice(0, 46)}…` : ex}
            </button>
          ))}
        </div>
      )}

      {clarify && (
        <p role="status" className="mt-3 rounded-control border border-caution/30 bg-caution-soft px-3 py-2 text-sm text-caution">
          {clarify}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-control border border-negative/25 bg-negative-soft px-3 py-2 text-sm font-semibold text-negative">
          {error}
        </p>
      )}

      {exhausted ? (
        <a href="/pricing" className="bdm-btn-secondary mt-3 w-full">
          You have used your AI drafts this month — see plans
        </a>
      ) : (
        <button type="submit" disabled={busy || !prompt.trim()} className="bdm-btn-primary mt-3 w-full">
          {busy ? 'Drafting…' : 'Draft invoice'}
        </button>
      )}
    </form>
  );
}

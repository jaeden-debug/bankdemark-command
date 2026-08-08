'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Proposal {
  kind: string;
  transactionKind: string;
  amountMajor: number;
  occurredOn: string;
  description: string;
  merchant?: string;
  accountId?: string;
  accountName?: string;
  categoryId?: string;
  summary: string;
  warnings: string[];
}

interface Turn {
  role: 'user' | 'zylx';
  content: string;
  tools?: Array<{ name: string; ok: boolean }>;
  proposal?: Proposal | null;
  approved?: boolean;
}

export default function ZylxChat({
  businessId,
  businessName,
  hasData,
  suggestions,
}: {
  businessId: string;
  businessName: string;
  hasData: boolean;
  suggestions: string[];
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const message = question.trim();
    if (!message || busy) return;

    setTurns((t) => [...t, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/zylx/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, message, conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Zylx could not answer that.');

      if (data.conversationId) setConversationId(data.conversationId);
      setTurns((t) => [
        ...t,
        { role: 'zylx', content: data.message, tools: data.toolCalls, proposal: data.proposal },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  }

  async function approve(index: number, proposal: Proposal) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/zylx/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, proposal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not record that.');

      setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, approved: true } : turn)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <div className="bdm-card p-5 sm:p-6">
          <h2 className="bdm-h2">Ask about {businessName}</h2>
          <p className="bdm-sub mt-1.5">
            Zylx reads your actual records. It doesn&apos;t estimate figures it can look up —
            every number comes from your ledger.
          </p>
          {!hasData && (
            <p className="mt-3 rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-[13px] text-ink">
              There are no transactions recorded yet, so there is nothing for Zylx to report on.
              Add one first and the answers become real.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)}
                      className="rounded-pill border border-gold-line bg-white/70 px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-gold/45 hover:bg-white">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {turns.map((turn, i) => (
        <div key={i} className={turn.role === 'user' ? 'flex justify-end' : ''}>
          {turn.role === 'user' ? (
            <p className="max-w-[85%] rounded-panel rounded-br-md bg-ink px-4 py-2.5 text-sm text-cream">
              {turn.content}
            </p>
          ) : (
            <div className="bdm-card p-4 sm:p-5">
              <div className="mb-2 flex items-center gap-2">
                <span aria-hidden className="text-gold">✦</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Zylx</span>
              </div>

              <div className="space-y-2.5 text-[15px] leading-relaxed text-ink">
                {turn.content.split('\n').filter(Boolean).map((line, j) => <p key={j}>{line}</p>)}
              </div>

              {turn.tools && turn.tools.length > 0 && (
                <p className="mt-3 text-[11px] text-muted">
                  Read from your records: {turn.tools.map((t) => t.name).join(', ')}
                </p>
              )}

              {turn.proposal && (
                <div className="mt-4 rounded-panel border border-gold/45 bg-gold-tint p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-dark">
                    Needs your approval
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-ink">{turn.proposal.summary}</p>

                  {turn.proposal.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {turn.proposal.warnings.map((w) => (
                        <li key={w} className="text-xs text-caution">— {w}</li>
                      ))}
                    </ul>
                  )}

                  {turn.approved ? (
                    <p className="mt-3 text-sm font-semibold text-positive">✓ Recorded</p>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button type="button" className="bdm-btn-gold bdm-btn-sm" disabled={busy}
                              onClick={() => approve(i, turn.proposal!)}>
                        Yes, record it
                      </button>
                      <button type="button" className="bdm-btn-ghost bdm-btn-sm" disabled={busy}
                              onClick={() => setTurns((t) => t.map((x, j) => (j === i ? { ...x, proposal: null } : x)))}>
                        No thanks
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {busy && (
        <div className="bdm-card p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-gold">✦</span>
            <span className="text-sm text-muted">Zylx is checking your records…</span>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <div ref={endRef} />

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}
            className="sticky bottom-[calc(var(--app-mobile-nav-h)+8px)] lg:bottom-4">
        <div className="flex gap-2 rounded-pill border border-gold-line bg-white/90 p-1.5 shadow-float backdrop-blur">
          <label className="sr-only" htmlFor="zylx-input">Ask Zylx</label>
          <input id="zylx-input" className="min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-muted/70"
                 value={input} onChange={(e) => setInput(e.target.value)}
                 placeholder="Ask about your numbers…" disabled={busy} />
          <button type="submit" className="bdm-btn-primary bdm-btn-sm shrink-0" disabled={busy || !input.trim()}>
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

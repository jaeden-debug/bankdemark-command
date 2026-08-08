'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ZylxBlocks from './ZylxBlocks';
import type { ZylxBlock } from '@/lib/zylx/envelope';

interface Turn {
  role: 'user' | 'zylx';
  content: string;
  blocks?: ZylxBlock[];
  /** Live status while a tool runs, cleared when the answer arrives. */
  status?: string | null;
  approved?: boolean;
  failed?: boolean;
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
  const abortRef = useRef<AbortController | null>(null);

  async function ask(question: string) {
    const message = question.trim();
    if (!message || busy) return;

    setTurns((t) => [...t, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    setError(null);

    // The assistant turn is created immediately and filled in as events
    // arrive, so the user sees progress rather than a frozen screen.
    const turnIndex = turns.length + 1;
    setTurns((t) => [...t, { role: 'zylx', content: '', status: 'Thinking' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/zylx/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, message, conversationId }),
        signal: controller.signal,
      });

      // Errors before the stream opens still arrive as JSON.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Zylx could not answer that.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const patch = (fn: (turn: Turn) => Turn) =>
        setTurns((t) => t.map((turn, i) => (i === turnIndex ? fn(turn) : turn)));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const eventLine = frame.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(7).trim();
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          if (event === 'status') {
            patch((turn) => ({ ...turn, status: String(payload.label ?? 'Working') }));
          } else if (event === 'text') {
            patch((turn) => ({
              ...turn,
              status: null,
              content: turn.content + String(payload.delta ?? ''),
            }));
          } else if (event === 'blocks') {
            patch((turn) => ({ ...turn, blocks: (payload.blocks as ZylxBlock[]) ?? [] }));
          } else if (event === 'done') {
            if (payload.conversationId) setConversationId(String(payload.conversationId));
            patch((turn) => ({ ...turn, status: null }));
          } else if (event === 'error') {
            patch((turn) => ({ ...turn, status: null, failed: true }));
            setError(String(payload.error ?? 'Something went wrong.'));
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setTurns((t) =>
          t.map((turn, i) =>
            i === turnIndex ? { ...turn, status: null, content: turn.content || 'Stopped.' } : turn
          )
        );
      } else {
        setTurns((t) => t.filter((_, i) => i !== turnIndex));
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function approve(index: number, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/zylx/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, proposal: payload }),
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

              {turn.status && (
                <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
                  {turn.status}…
                </p>
              )}

              {turn.content && (
                <div className="space-y-2.5 text-[15px] leading-relaxed text-ink">
                  {turn.content.split('\n').filter(Boolean).map((line, j) => <p key={j}>{line}</p>)}
                </div>
              )}

              {turn.blocks && turn.blocks.length > 0 && (
                <ZylxBlocks
                  blocks={turn.blocks}
                  approving={busy}
                  approved={turn.approved}
                  onApprove={(payload) => approve(i, payload)}
                />
              )}
            </div>
          )}
        </div>
      ))}

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
          {busy ? (
            <button type="button" onClick={stop} className="bdm-btn-secondary bdm-btn-sm shrink-0">
              Stop
            </button>
          ) : (
            <button type="submit" className="bdm-btn-primary bdm-btn-sm shrink-0" disabled={!input.trim()}>
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

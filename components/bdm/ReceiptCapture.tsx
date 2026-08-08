'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Extraction {
  vendor: string | null;
  date: string | null;
  totalFormatted: string | null;
  totalMinor: number | null;
  taxFormatted: string | null;
  suggestedCategorySlug: string | null;
  confidence: number;
  uncertainties: string[];
  arithmeticWarning: string | null;
  suspectedInjection: boolean;
}

interface Match {
  transactionId: string;
  date: string | null;
  description: string | null;
  amount: string | null;
  score: number;
  reasons: string[];
  confident: boolean;
}

/**
 * Photograph a receipt, check what was read, save it.
 *
 * On a phone this opens the camera directly — a receipt is something you
 * are holding, and making someone find it in a photo library afterwards
 * is the difference between doing it and not.
 *
 * Everything read is shown as an EDITABLE FORM, never as a finished
 * answer. A machine read someone else's document; the person confirms.
 */
export default function ReceiptCapture({
  businessId,
  currency,
  accounts,
  categories,
}: {
  businessId: string;
  currency: string;
  accounts: Array<{ id: string; name: string; account_kind: string }>;
  categories: Array<{ id: string; name: string; slug: string }>;
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<'capture' | 'reading' | 'review' | 'done'>('capture');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [likelyDuplicate, setLikelyDuplicate] = useState<Match | null>(null);
  const [candidates, setCandidates] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Editable form values, seeded from the extraction.
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [accountId, setAccountId] = useState(
    accounts.find((a) => a.account_kind === 'credit_card')?.id ?? accounts[0]?.id ?? ''
  );
  const [categoryId, setCategoryId] = useState('');

  async function upload(file: File) {
    setStage('reading');
    setError(null);
    setNotice(null);

    try {
      const form = new FormData();
      form.append('businessId', businessId);
      form.append('file', file);
      form.append('docType', 'receipt');

      const res = await fetch('/api/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'That file could not be saved.');

      setDocumentId(data.document?.id ?? null);

      if (data.duplicate) {
        setNotice(data.message ?? 'You have already uploaded this file.');
        setStage('capture');
        return;
      }

      if (!data.extraction) {
        // Stored but unread — go straight to a blank form rather than
        // pretending something was extracted.
        setNotice(data.message ?? 'Saved, but it could not be read automatically.');
        setExtraction(null);
        setDate(new Date().toISOString().slice(0, 10));
        setStage('review');
        return;
      }

      const e = data.extraction as Extraction;
      setExtraction(e);
      setVendor(e.vendor ?? '');
      setDate(e.date ?? new Date().toISOString().slice(0, 10));
      setAmount(e.totalMinor !== null ? (Math.abs(e.totalMinor) / 100).toFixed(2) : '');
      setCategoryId(categories.find((c) => c.slug === e.suggestedCategorySlug)?.id ?? '');
      setLikelyDuplicate(data.matches?.likelyDuplicate ?? null);
      setCandidates(data.matches?.candidates ?? []);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStage('capture');
    }
  }

  async function attachToExisting(transactionId: string) {
    if (!documentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/documents/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, documentId, action: 'attach', transactionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not attach that receipt.');
      setStage('done');
      setNotice('Attached to the transaction you already had.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach that receipt.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!documentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/documents/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          documentId,
          transactionKind: 'expense',
          accountId,
          occurredOn: date,
          amountMajor: amount,
          description: vendor || 'Receipt',
          merchant: vendor || null,
          categoryId: categoryId || null,
          extractionConfidence: extraction?.confidence ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save that.');
      setStage('done');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage('capture');
    setDocumentId(null);
    setExtraction(null);
    setLikelyDuplicate(null);
    setCandidates([]);
    setError(null);
    setNotice(null);
    setVendor('');
    setAmount('');
    setDate('');
    setCategoryId('');
  }

  // ── Done ────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className="bdm-card p-7 text-center">
        <p className="bdm-figure-xl text-positive">✓</p>
        <h2 className="bdm-h2 mt-2">Saved</h2>
        <p className="bdm-sub mx-auto mt-2 max-w-sm">
          {notice ?? 'The receipt is attached and your dashboard is updated.'}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" className="bdm-btn-gold" onClick={reset}>
            Add another
          </button>
          <a href={`/b/${businessId}/transactions`} className="bdm-btn-secondary">
            See transactions
          </a>
        </div>
      </div>
    );
  }

  // ── Capture ─────────────────────────────────────────────
  if (stage === 'capture' || stage === 'reading') {
    return (
      <div className="space-y-3">
        <div className="bdm-card p-7 text-center">
          {stage === 'reading' ? (
            <>
              <p className="flex items-center justify-center gap-2 text-[15px] font-bold text-ink">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gold" />
                Reading your receipt…
              </p>
              <p className="bdm-sub mt-2">This takes a few seconds.</p>
            </>
          ) : (
            <>
              <h2 className="bdm-h2">Snap a receipt</h2>
              <p className="bdm-sub mx-auto mt-2 max-w-sm">
                We&apos;ll read the merchant, date and total, then check whether it&apos;s
                already in your books.
              </p>

              <div className="mt-6 flex flex-col gap-2">
                {/* `capture` opens the camera directly on a phone. */}
                <button
                  type="button"
                  className="bdm-btn-gold w-full py-3.5 text-base sm:hidden"
                  onClick={() => cameraRef.current?.click()}
                >
                  Take a photo
                </button>
                <button
                  type="button"
                  className="bdm-btn-secondary w-full py-3.5 text-base sm:w-auto sm:self-center sm:px-8"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose a file
                </button>
              </div>

              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = '';
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = '';
                }}
              />
              <p className="mt-4 text-xs text-muted">JPG, PNG, WEBP, HEIC or PDF. Up to 15 MB.</p>
            </>
          )}
        </div>

        {notice && (
          <p role="status" className="rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-sm text-ink">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ── Review ──────────────────────────────────────────────
  const lowConfidence = extraction !== null && extraction.confidence < 0.6;

  return (
    <div className="space-y-3">
      {/* A likely duplicate is offered BEFORE the form, because the best
          outcome here is not creating a second record at all. */}
      {likelyDuplicate && (
        <div className="bdm-card border-gold/45 bg-gold-tint p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-dark">
            You may already have this
          </p>
          <p className="mt-2 text-sm font-semibold text-ink">
            {likelyDuplicate.description} · {likelyDuplicate.amount} · {likelyDuplicate.date}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {likelyDuplicate.reasons.join(', ')}.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="bdm-btn-gold bdm-btn-sm"
              disabled={busy}
              onClick={() => attachToExisting(likelyDuplicate.transactionId)}
            >
              Yes — attach the receipt to it
            </button>
            <button
              type="button"
              className="bdm-btn-ghost bdm-btn-sm"
              onClick={() => setLikelyDuplicate(null)}
            >
              No, this is separate
            </button>
          </div>
        </div>
      )}

      <div className="bdm-card space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="bdm-h2">Check what we read</h2>
          <p className="bdm-sub mt-1">
            {extraction
              ? 'Change anything that looks wrong before saving.'
              : 'We could not read this one — fill it in yourself.'}
          </p>
        </div>

        {extraction?.suspectedInjection && (
          <p className="rounded-control border border-negative/30 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative">
            <strong className="font-bold">Check this one carefully.</strong> This document contains
            text that reads like an instruction to a computer rather than part of a receipt. It was
            ignored, but treat every figure below as unverified.
          </p>
        )}

        {lowConfidence && !extraction?.suspectedInjection && (
          <p className="rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-[13px] text-ink">
            The image was hard to read, so please check each field.
          </p>
        )}

        {extraction?.arithmeticWarning && (
          <p className="rounded-control border border-caution/30 bg-caution-soft px-3.5 py-2.5 text-[13px] text-caution">
            {extraction.arithmeticWarning}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="bdm-label" htmlFor="r-vendor">Who was it with?</label>
            <input id="r-vendor" className="bdm-input" value={vendor}
                   onChange={(e) => setVendor(e.target.value)} placeholder="Blue Bottle Coffee" />
          </div>
          <div>
            <label className="bdm-label" htmlFor="r-amount">Total ({currency})</label>
            <input id="r-amount" className="bdm-input" inputMode="decimal" required
                   value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="42.10" />
          </div>
          <div>
            <label className="bdm-label" htmlFor="r-date">Date</label>
            <input id="r-date" type="date" className="bdm-input" required
                   value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="bdm-label" htmlFor="r-account">Paid from</label>
            <select id="r-account" className="bdm-select" value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="bdm-label" htmlFor="r-category">Category</label>
          <select id="r-category" className="bdm-select" value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Not sure yet</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {extraction?.suggestedCategorySlug && (
            <span className="bdm-hint">Suggested from the receipt. Change it if that&apos;s wrong.</span>
          )}
        </div>

        {extraction && extraction.uncertainties.length > 0 && (
          <details className="rounded-panel border border-gold-line bg-white/50 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink">
              What we weren&apos;t sure about
            </summary>
            <ul className="mt-2 space-y-1">
              {extraction.uncertainties.map((u) => (
                <li key={u} className="text-[13px] text-muted">— {u}</li>
              ))}
            </ul>
          </details>
        )}

        {candidates.length > 0 && !likelyDuplicate && (
          <details className="rounded-panel border border-gold-line bg-white/50 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink">
              {candidates.length} similar transaction{candidates.length === 1 ? '' : 's'} already recorded
            </summary>
            <ul className="mt-2 space-y-2">
              {candidates.map((c) => (
                <li key={c.transactionId} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-muted">
                    {c.description} · {c.amount} · {c.date}
                  </span>
                  <button type="button" className="bdm-btn-ghost bdm-btn-sm" disabled={busy}
                          onClick={() => attachToExisting(c.transactionId)}>
                    Attach to this
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="sticky bottom-[calc(var(--app-mobile-nav-h)+10px)] flex flex-col gap-2 sm:flex-row lg:static">
        <button type="button" className="bdm-btn-gold flex-1 py-3.5 text-base shadow-float"
                disabled={busy || !amount} onClick={save}>
          {busy ? 'Saving…' : 'Save as an expense'}
        </button>
        <button type="button" className="bdm-btn-ghost" onClick={reset} disabled={busy}>
          Start over
        </button>
      </div>
    </div>
  );
}

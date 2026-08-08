'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMinor } from '@/lib/domain/money';

interface PreviewRow {
  rowNumber: number;
  occurredOn: string | null;
  amountMinor: number | null;
  description: string;
  state: 'ready' | 'duplicate' | 'error';
  problem?: string;
}

interface Preview {
  needsDateOrder: boolean;
  dateOrder: string;
  rows: PreviewRow[];
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
  totalInMinor: number;
  totalOutMinor: number;
  truncated: boolean;
}

/**
 * Drop a file, glance at what will land, confirm. Three moments.
 *
 * Column mapping is deliberately not exposed — it is detected, and the
 * preview proves whether the detection was right far better than a
 * screen of dropdowns would.
 */
export default function ImportWizard({
  businessId,
  currency,
  accounts,
}: {
  businessId: string;
  currency: string;
  accounts: Array<{ id: string; name: string; account_kind: string }>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState(
    accounts.find((a) => a.account_kind === 'bank')?.id ?? accounts[0]?.id ?? ''
  );
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy' | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imported: number; duplicates: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  async function readFile(file: File) {
    setError(null);
    setDone(null);
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
      setError('Please choose a .csv file exported from your bank.');
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    await runPreview(text, undefined);
  }

  async function runPreview(text: string, order?: 'dmy' | 'mdy') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, accountId, csv: text, dateOrder: order }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not read that file.');
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId, accountId, csv, filename,
          action: 'commit',
          dateOrder: dateOrder || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The import did not finish.');
      setDone({ imported: data.importedCount, duplicates: data.skippedDuplicates });
      setPreview(null);
      setCsv('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import did not finish.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCsv('');
    setFilename('');
    setPreview(null);
    setDone(null);
    setDateOrder('');
    setError(null);
  }

  // ── Success ───────────────────────────────────────────────
  if (done) {
    return (
      <div className="bdm-card p-7 text-center">
        <p className="bdm-figure-xl text-positive">{done.imported}</p>
        <h2 className="bdm-h2 mt-2">
          transaction{done.imported === 1 ? '' : 's'} imported
        </h2>
        <p className="bdm-sub mx-auto mt-2 max-w-sm">
          {done.duplicates > 0
            ? `We skipped ${done.duplicates} you already had. `
            : ''}
          They&apos;re waiting for you to confirm what they were.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <a href={`/b/${businessId}/transactions?filter=uncategorized`} className="bdm-btn-gold">
            Review them
          </a>
          <button type="button" className="bdm-btn-secondary" onClick={reset}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Account ──────────────────────────────────────── */}
      <div className="bdm-card p-5">
        <label className="bdm-label" htmlFor="import-account">Which account is this file from?</label>
        <select
          id="import-account"
          className="bdm-select"
          value={accountId}
          onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}
        >
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* ── Drop zone ────────────────────────────────────── */}
      {!preview && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void readFile(file);
          }}
          className={`bdm-card border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? 'border-gold bg-gold-tint' : 'border-gold-line'
          }`}
        >
          <p className="text-[15px] font-bold text-ink">
            {busy ? 'Reading your file…' : 'Drop your bank export here'}
          </p>
          <p className="bdm-sub mx-auto mt-1.5 max-w-sm">
            A CSV from your bank, Stripe or spreadsheet. We work out which columns are which.
          </p>
          <button
            type="button"
            className="bdm-btn-secondary mt-5"
            onClick={() => inputRef.current?.click()}
            disabled={busy || !accountId}
          >
            Choose a file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      {/* ── The one thing we won't guess ─────────────────── */}
      {preview?.needsDateOrder && (
        <div className="bdm-card border-gold/45 bg-gold-tint p-5">
          <h2 className="bdm-h2">Quick question about the dates</h2>
          <p className="bdm-sub mt-1.5">
            This file uses dates like <strong className="font-bold text-ink">03/04/2026</strong>, which could
            mean either day. Getting it wrong would move transactions by months, so we&apos;d rather ask.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {([
              ['dmy', 'Day first', '03/04 means 3 April'],
              ['mdy', 'Month first', '03/04 means 4 March'],
            ] as const).map(([id, label, hint]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setDateOrder(id); void runPreview(csv, id); }}
                className="rounded-control border border-gold-line bg-white/70 p-3.5 text-left transition-all hover:border-gold"
              >
                <span className="block text-sm font-bold text-ink">{label}</span>
                <span className="mt-0.5 block text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Preview ──────────────────────────────────────── */}
      {preview && !preview.needsDateOrder && (
        <>
          <div className="bdm-card p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="bdm-eyebrow">Ready to import</p>
                <p className="bdm-figure-xl mt-1">{preview.readyCount}</p>
              </div>
              <div className="flex gap-6 text-right">
                <span>
                  <span className="bdm-eyebrow block">Money in</span>
                  <span className="bdm-num text-[15px] font-bold text-positive">
                    {formatMinor(preview.totalInMinor, currency)}
                  </span>
                </span>
                <span>
                  <span className="bdm-eyebrow block">Money out</span>
                  <span className="bdm-num text-[15px] font-bold text-negative">
                    {formatMinor(preview.totalOutMinor, currency)}
                  </span>
                </span>
              </div>
            </div>

            {(preview.duplicateCount > 0 || preview.errorCount > 0 || preview.truncated) && (
              <ul className="mt-4 space-y-1 border-t border-gold-line pt-3 text-[13px] text-muted">
                {preview.duplicateCount > 0 && (
                  <li>{preview.duplicateCount} already in your books — we&apos;ll skip those.</li>
                )}
                {preview.errorCount > 0 && (
                  <li>{preview.errorCount} row{preview.errorCount === 1 ? '' : 's'} we couldn&apos;t read — skipped.</li>
                )}
                {preview.truncated && <li>Only the first 5,000 rows are included.</li>}
              </ul>
            )}
          </div>

          <details className="bdm-card p-5">
            <summary className="cursor-pointer text-[15px] font-bold text-ink">
              Check a few rows first
            </summary>
            <div className="bdm-scroll-x mt-4">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="sr-only">Sample of rows to be imported</caption>
                <thead>
                  <tr className="border-b border-gold-line text-left">
                    <th scope="col" className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Date</th>
                    <th scope="col" className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Description</th>
                    <th scope="col" className="pb-2 text-right text-[11px] font-bold uppercase tracking-wider text-muted">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 12).map((r) => (
                    <tr key={r.rowNumber} className="border-b border-gold-line/60 last:border-0">
                      <td className="whitespace-nowrap py-2 text-muted">{r.occurredOn ?? '—'}</td>
                      <td className="py-2 text-ink">
                        {r.description}
                        {r.state === 'duplicate' && <span className="ml-2 text-xs text-muted">already have it</span>}
                        {r.state === 'error' && <span className="ml-2 text-xs text-caution">{r.problem}</span>}
                      </td>
                      <td className={`bdm-num whitespace-nowrap py-2 text-right font-semibold ${
                        (r.amountMinor ?? 0) < 0 ? 'text-negative' : 'text-positive'
                      }`}>
                        {r.amountMinor === null ? '—' : formatMinor(r.amountMinor, currency, { showMinor: true, signDisplay: 'always' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="sticky bottom-[calc(var(--app-mobile-nav-h)+10px)] flex flex-col gap-2 sm:flex-row lg:static">
            <button
              type="button"
              className="bdm-btn-gold flex-1 py-3.5 text-base shadow-float"
              onClick={commit}
              disabled={busy || preview.readyCount === 0}
            >
              {busy ? 'Importing…' : `Import ${preview.readyCount} transaction${preview.readyCount === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="bdm-btn-ghost" onClick={reset} disabled={busy}>
              Choose a different file
            </button>
          </div>
        </>
      )}
    </div>
  );
}

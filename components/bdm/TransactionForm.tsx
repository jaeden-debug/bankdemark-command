'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  KIND_HELP,
  KIND_LABELS,
  suggestedKindsForBusinessType,
  type TransactionKind,
} from '@/lib/domain/semantics';

export interface FormAccount { id: string; name: string; account_kind: string }
export interface FormCategory { id: string; name: string; kind: string; slug: string }
export interface FormBrand { id: string; name: string }

const OUTBOUND: TransactionKind[] = [
  'expense', 'owner_draw', 'loan_payment', 'credit_card_payment',
  'refund', 'asset_purchase', 'tax_payment',
];

export default function TransactionForm({
  businessId,
  businessType,
  currency,
  earnsCommissions,
  accounts,
  categories,
  brands,
  initialKind,
}: {
  businessId: string;
  businessType: string;
  currency: string;
  earnsCommissions: boolean;
  accounts: FormAccount[];
  categories: FormCategory[];
  brands: FormBrand[];
  initialKind?: TransactionKind;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'single' | 'transfer'>('single');
  const [kind, setKind] = useState<TransactionKind>(initialKind ?? 'expense');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? '');
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [grossAmount, setGrossAmount] = useState('');
  const [description, setDescription] = useState('');
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kinds = useMemo(() => {
    const suggested = suggestedKindsForBusinessType(businessType);
    return earnsCommissions && !suggested.includes('commission')
      ? [...suggested, 'commission' as TransactionKind]
      : suggested;
  }, [businessType, earnsCommissions]);

  const relevantCategories = useMemo(() => {
    const wanted =
      kind === 'income' || kind === 'commission' || kind === 'refund' ? 'income' : 'expense';
    return categories.filter((c) => c.kind === wanted);
  }, [categories, kind]);

  const isOutbound = OUTBOUND.includes(kind);
  const showsGross = kind === 'commission';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload =
        mode === 'transfer'
          ? {
              businessId, mode: 'transfer',
              fromAccountId: accountId, toAccountId,
              occurredOn, amountMajor: amount, description,
              isCreditCardPayment:
                accounts.find((a) => a.id === toAccountId)?.account_kind === 'credit_card',
            }
          : {
              businessId, transactionKind: kind, accountId, occurredOn,
              amountMajor: amount, description, merchant: merchant || null,
              categoryId: categoryId || null, brandId: brandId || null, notes: notes || null,
              grossAmountMajor: showsGross && grossAmount ? grossAmount : null,
            };

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save that.');

      router.push(`/b/${businessId}/transactions`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="bdm-card p-6">
        <h1 className="bdm-h2">Add an account first</h1>
        <p className="bdm-sub mt-1.5">
          Every transaction belongs to an account, so we need at least one before you can record anything.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bdm-card p-5 sm:p-6">
      <div className="mb-5 flex rounded-pill border border-gold-line bg-white/60 p-1" role="tablist">
        {([['single', 'Money in or out'], ['transfer', 'Move between accounts']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-pill px-3 py-2 text-[13px] font-semibold transition-colors ${
              mode === m ? 'bg-ink text-cream' : 'text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'single' ? (
        <div className="space-y-4">
          <fieldset>
            <legend className="bdm-label">What kind of movement is this?</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setKind(k); setCategoryId(''); }}
                  aria-pressed={kind === k}
                  className={`rounded-control border px-3 py-2 text-left text-sm font-semibold transition-all ${
                    kind === k ? 'border-gold bg-gold-tint text-ink' : 'border-gold-line bg-white/60 text-muted hover:border-gold/45'
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <p className="bdm-hint">{KIND_HELP[kind]}</p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="bdm-label" htmlFor="amount">
                Amount ({currency}) {isOutbound ? '— money out' : '— money in'}
              </label>
              <input id="amount" className="bdm-input" inputMode="decimal" required
                     value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="82.54" />
              <span className="bdm-hint">Always enter a positive number. The type above sets the direction.</span>
            </div>

            <div>
              <label className="bdm-label" htmlFor="date">Date</label>
              <input id="date" type="date" className="bdm-input" required
                     value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </div>
          </div>

          {showsGross && (
            <div className="rounded-panel border border-gold-line bg-gold-tint p-4">
              <label className="bdm-label" htmlFor="gross">Total sale or booking value ({currency})</label>
              <input id="gross" className="bdm-input" inputMode="decimal"
                     value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} placeholder="6000.00" />
              <span className="bdm-hint">
                Optional. If you sold a $6,000 trip and earned $600, put $6,000 here and $600 in the
                amount above. We&apos;ll report $6,000 booked and $600 earned — not $6,000 of revenue.
              </span>
            </div>
          )}

          <div>
            <label className="bdm-label" htmlFor="desc">What was it?</label>
            <input id="desc" className="bdm-input" required value={description}
                   onChange={(e) => setDescription(e.target.value)} placeholder="Facebook Ads — July campaign" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="bdm-label" htmlFor="account">Which account?</label>
              <select id="account" className="bdm-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bdm-label" htmlFor="category">Category</label>
              <select id="category" className="bdm-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Not sure yet</option>
                {relevantCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className="bdm-hint">You can leave this and sort it later.</span>
            </div>
          </div>

          {brands.length > 0 && (
            <div>
              <label className="bdm-label" htmlFor="brand">Which brand?</label>
              <select id="brand" className="bdm-select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">Shared across the company</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <span className="bdm-hint">
                Leave this on &ldquo;shared&rdquo; for company-wide costs. We report shared amounts separately
                rather than splitting them across brands, so nothing is allocated for you.
              </span>
            </div>
          )}

          <details className="rounded-panel border border-gold-line bg-white/50 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink">More detail</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="bdm-label" htmlFor="merchant">Who was it with?</label>
                <input id="merchant" className="bdm-input" value={merchant}
                       onChange={(e) => setMerchant(e.target.value)} placeholder="Meta Platforms" />
              </div>
              <div>
                <label className="bdm-label" htmlFor="notes">Notes</label>
                <input id="notes" className="bdm-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </details>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-control border border-gold-line bg-gold-tint px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
            Moving your own money between your own accounts. This never counts as revenue or as an
            expense — we record both sides so your totals stay correct.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="bdm-label" htmlFor="from">From</label>
              <select id="from" className="bdm-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bdm-label" htmlFor="to">To</label>
              <select id="to" className="bdm-select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="bdm-label" htmlFor="tamount">Amount ({currency})</label>
              <input id="tamount" className="bdm-input" inputMode="decimal" required
                     value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000.00" />
            </div>
            <div>
              <label className="bdm-label" htmlFor="tdate">Date</label>
              <input id="tdate" type="date" className="bdm-input" required
                     value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="bdm-label" htmlFor="tdesc">Note (optional)</label>
            <input id="tdesc" className="bdm-input" value={description}
                   onChange={(e) => setDescription(e.target.value)} placeholder="Moved to savings" />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button type="submit" className="bdm-btn-gold" disabled={busy}>
          {busy ? 'Saving…' : mode === 'transfer' ? 'Record transfer' : 'Save transaction'}
        </button>
      </div>
    </form>
  );
}

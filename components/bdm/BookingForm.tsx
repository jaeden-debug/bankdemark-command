'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMinor, parseMajorToMinor } from '@/lib/domain/money';

/**
 * Four fields and you're done.
 *
 * The commission rate and the commission amount are two views of one
 * number — type either and the other fills in. The live summary shows
 * what the owner actually earns, so nobody has to work it out.
 */
export default function BookingForm({
  businessId,
  currency,
  brands,
  noun,
}: {
  businessId: string;
  currency: string;
  brands: Array<{ id: string; name: string }>;
  noun: { singular: string; sold: string };
}) {
  const router = useRouter();
  const [client, setClient] = useState('');
  const [description, setDescription] = useState('');
  const [gross, setGross] = useState('');
  const [commission, setCommission] = useState('');
  const [rate, setRate] = useState('');
  const [lastEdited, setLastEdited] = useState<'amount' | 'rate'>('rate');
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
  const [brandId, setBrandId] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [serviceFee, setServiceFee] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeMinor = (v: string) => {
    try {
      return v.trim() ? parseMajorToMinor(v, currency) : 0;
    } catch {
      return 0;
    }
  };

  const grossMinor = safeMinor(gross);

  // Whichever the owner typed last wins; the other is derived.
  const { commissionMinor, impliedRate } = useMemo(() => {
    if (lastEdited === 'amount') {
      const c = safeMinor(commission);
      return { commissionMinor: c, impliedRate: grossMinor > 0 ? (c / grossMinor) * 100 : null };
    }
    const r = Number(rate);
    if (!Number.isFinite(r) || !rate.trim()) return { commissionMinor: 0, impliedRate: null };
    return { commissionMinor: Math.round(grossMinor * (r / 100)), impliedRate: r };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEdited, commission, rate, grossMinor, currency]);

  const feeMinor = safeMinor(serviceFee);
  const youEarnMinor = commissionMinor + feeMinor;
  const showSummary = grossMinor > 0 || youEarnMinor > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          clientName: client || null,
          description,
          grossValueMajor: gross || 0,
          // Send whichever the owner actually typed.
          commissionMajor: lastEdited === 'amount' ? commission : null,
          commissionRatePercent: lastEdited === 'rate' && rate ? Number(rate) : null,
          serviceFeeMajor: serviceFee || null,
          bookingDate,
          brandId: brandId || null,
          reference: reference || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save that.');
      router.push(`/b/${businessId}/money-in`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="bdm-card space-y-4 p-5 sm:p-6">
        <div>
          <label className="bdm-label" htmlFor="client">Who was it for?</label>
          <input id="client" className="bdm-input" value={client} autoFocus
                 onChange={(e) => setClient(e.target.value)} placeholder="Jane Smith" />
          <span className="bdm-hint">We&apos;ll remember them for next time.</span>
        </div>

        <div>
          <label className="bdm-label" htmlFor="desc">What did they {noun.sold}?</label>
          <input id="desc" className="bdm-input" required value={description}
                 onChange={(e) => setDescription(e.target.value)}
                 placeholder="Two weeks in Portugal, June" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="bdm-label" htmlFor="gross">Total they paid</label>
            <input id="gross" className="bdm-input" inputMode="decimal" required
                   value={gross} onChange={(e) => setGross(e.target.value)} placeholder="6,000" />
          </div>
          <div>
            <label className="bdm-label" htmlFor="date">Date</label>
            <input id="date" type="date" className="bdm-input" required
                   value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
          </div>
        </div>

        <fieldset>
          <legend className="bdm-label">What do you earn?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="sr-only" htmlFor="rate">Commission rate, percent</label>
              <div className="relative">
                <input id="rate" className="bdm-input pr-9" inputMode="decimal" value={rate}
                       onChange={(e) => { setRate(e.target.value); setLastEdited('rate'); }}
                       placeholder="10" />
                <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
              </div>
            </div>
            <div>
              <label className="sr-only" htmlFor="commission">Commission amount</label>
              <input
                id="commission"
                className="bdm-input"
                inputMode="decimal"
                value={lastEdited === 'rate' && commissionMinor > 0
                  ? formatMinor(commissionMinor, currency, { showMinor: true }).replace(/[^0-9.,]/g, '')
                  : commission}
                onChange={(e) => { setCommission(e.target.value); setLastEdited('amount'); }}
                placeholder="600"
              />
            </div>
          </div>
          <span className="bdm-hint">
            Fill in either one — we work out the other.
            {lastEdited === 'amount' && impliedRate !== null && grossMinor > 0 &&
              ` That's ${impliedRate.toFixed(1)}% of the total.`}
          </span>
        </fieldset>

        {brands.length > 0 && (
          <div>
            <label className="bdm-label" htmlFor="brand">Which brand?</label>
            <select id="brand" className="bdm-select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">Not brand-specific</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        {!showMore ? (
          <button type="button" className="bdm-btn-ghost bdm-btn-sm" onClick={() => setShowMore(true)}>
            + Service fee or reference
          </button>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="bdm-label" htmlFor="fee">Service fee you charged</label>
              <input id="fee" className="bdm-input" inputMode="decimal" value={serviceFee}
                     onChange={(e) => setServiceFee(e.target.value)} placeholder="75" />
              <span className="bdm-hint">Charged to the client on top of commission.</span>
            </div>
            <div>
              <label className="bdm-label" htmlFor="ref">Reference</label>
              <input id="ref" className="bdm-input" value={reference}
                     onChange={(e) => setReference(e.target.value)} placeholder="ABC123" />
            </div>
          </div>
        )}
      </div>

      {/* The whole point of the product, stated plainly. */}
      {showSummary && (
        <div className="bdm-card border-gold/40 bg-gold-tint p-5" aria-live="polite">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="bdm-eyebrow">You earn</p>
              <p className="bdm-figure-xl mt-1">{formatMinor(youEarnMinor, currency)}</p>
            </div>
            <div className="text-right">
              <p className="bdm-eyebrow">{noun.singular} value</p>
              <p className="bdm-figure-lg mt-1 text-muted">{formatMinor(grossMinor, currency)}</p>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink">
            Your revenue goes up by <strong className="font-bold">{formatMinor(youEarnMinor, currency)}</strong>,
            not {formatMinor(grossMinor, currency)}. The full amount is tracked separately as
            {' '}{noun.singular.toLowerCase()} volume.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="sticky bottom-[calc(var(--app-mobile-nav-h)+10px)] lg:static lg:bottom-auto">
        <button type="submit" className="bdm-btn-gold w-full py-3.5 text-base shadow-float lg:w-auto lg:px-8" disabled={busy}>
          {busy ? 'Saving…' : `Save ${noun.singular.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}

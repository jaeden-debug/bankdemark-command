'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TravelBookingForm({ businessId, currency }: { businessId: string; currency: string }) {
  const router = useRouter();
  const [reference, setReference] = useState('');
  const [commission, setCommission] = useState('');
  const [departure, setDeparture] = useState('');
  const [bookingCurrency, setBookingCurrency] = useState(currency);
  const [more, setMore] = useState(false);
  const [values, setValues] = useState({ client: '', supplier: '', host: '', gross: '', rate: '', returnDate: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId, reference, commissionMajor: commission, serviceDate: departure || null,
          clientName: values.client || null, supplierName: values.supplier || null,
          hostAgencyName: values.host || null, grossValueMajor: values.gross || 0,
          commissionRatePercent: values.rate ? Number(values.rate) : null,
          returnDate: values.returnDate || null, currency: bookingCurrency, notes: values.notes || null,
          description: `Booking ${reference}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add that booking.');
      router.push(`/b/${businessId}/dashboard`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add that booking.'); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="bdm-card space-y-4 p-5 sm:p-6">
        <div><label className="bdm-label" htmlFor="booking-reference">Booking #</label>
          <input id="booking-reference" className="bdm-input text-lg font-bold" required autoFocus value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ABC123" /></div>
        <div><label className="bdm-label" htmlFor="expected-commission">Expected commission</label>
          <div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">{bookingCurrency}</span>
            <input id="expected-commission" className="bdm-input pl-14 text-lg font-bold" required inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="425.00" /></div>
          <p className="bdm-hint">Expected only. This does not record income or mark the booking paid.</p></div>
        <div><label className="bdm-label" htmlFor="departure">Departure date <span className="font-normal text-muted">(optional)</span></label>
          <input id="departure" type="date" className="bdm-input" value={departure} onChange={(e) => setDeparture(e.target.value)} /></div>

        {!more ? <button type="button" className="bdm-btn-ghost bdm-btn-sm" onClick={() => setMore(true)}>+ Add traveller, supplier and trip details</button> : (
          <div className="grid gap-4 border-t border-gold-line pt-4 sm:grid-cols-2">
            <Field label="Traveller / client" value={values.client} onChange={(v) => set('client', v)} />
            <Field label="Supplier" value={values.supplier} onChange={(v) => set('supplier', v)} />
            <Field label="Host agency" value={values.host} onChange={(v) => set('host', v)} />
            <Field label="Gross booking value" value={values.gross} inputMode="decimal" onChange={(v) => set('gross', v)} />
            <Field label="Commission %" value={values.rate} inputMode="decimal" onChange={(v) => set('rate', v)} />
            <Field label="Currency" value={bookingCurrency} onChange={(v) => setBookingCurrency(v.toUpperCase().slice(0, 3))} />
            <div><label className="bdm-label">Return date</label><input type="date" className="bdm-input" value={values.returnDate} onChange={(e) => set('returnDate', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="bdm-label">Notes</label><textarea className="bdm-input min-h-24" value={values.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-control bg-negative-soft p-3 text-sm text-negative">{error}</p>}
      <button className="bdm-btn-gold w-full py-3.5 text-base sm:w-auto" disabled={busy}>{busy ? 'Adding…' : 'Add booking'}</button>
    </form>
  );
}

function Field({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (value: string) => void; inputMode?: 'decimal' }) {
  return <div><label className="bdm-label">{label}</label><input className="bdm-input" inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

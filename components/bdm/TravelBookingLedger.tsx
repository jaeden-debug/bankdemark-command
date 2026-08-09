'use client';

import { useMemo, useState } from 'react';
import { formatMinor } from '@/lib/domain/money';

type Booking = {
  id: string; reference: string | null; service_date: string | null; supplier_id: string | null;
  commission_expected_minor: number; commission_received_minor: number; currency: string;
};

export default function TravelBookingLedger({ bookings, suppliers, attentionBookingIds }: {
  bookings: Booking[]; suppliers: Record<string, string>; attentionBookingIds: string[];
}) {
  const [reference, setReference] = useState(''); const [status, setStatus] = useState('all');
  const [supplier, setSupplier] = useState(''); const [date, setDate] = useState('');
  const [min, setMin] = useState(''); const [max, setMax] = useState('');
  const attention = useMemo(() => new Set(attentionBookingIds), [attentionBookingIds]);
  const state = (b: Booking) => attention.has(b.id) ? 'needs_attention' : b.commission_expected_minor > 0 && b.commission_received_minor >= b.commission_expected_minor ? 'paid' : 'pending';
  const filtered = bookings.filter((b) => {
    const amount = b.commission_expected_minor / 100;
    return (!reference || b.reference?.toLowerCase().includes(reference.toLowerCase())) &&
      (status === 'all' || state(b) === status) && (!supplier || b.supplier_id === supplier) &&
      (!date || b.service_date === date) && (!min || amount >= Number(min)) && (!max || amount <= Number(max));
  });

  return <section aria-label="Bookings">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="bdm-eyebrow">Commission ledger</p><h2 className="bdm-h2">Bookings</h2></div><span className="text-xs text-muted">{filtered.length} shown</span></div>
    <div className="bdm-card mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
      <input aria-label="Search booking reference" className="bdm-input" placeholder="Search booking #" value={reference} onChange={(e) => setReference(e.target.value)} />
      <select aria-label="Filter status" className="bdm-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="needs_attention">Needs attention</option></select>
      <select aria-label="Filter supplier" className="bdm-select" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">All suppliers</option>{Object.entries(suppliers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <input aria-label="Filter departure date" type="date" className="bdm-input" value={date} onChange={(e) => setDate(e.target.value)} />
      <input aria-label="Minimum commission" inputMode="decimal" className="bdm-input" placeholder="Min commission" value={min} onChange={(e) => setMin(e.target.value)} />
      <input aria-label="Maximum commission" inputMode="decimal" className="bdm-input" placeholder="Max commission" value={max} onChange={(e) => setMax(e.target.value)} />
    </div>
    <ul className="space-y-2">{filtered.map((booking) => {
      const s = state(booking); return <li key={booking.id} className="bdm-card flex items-center justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0"><p className="truncate text-lg font-extrabold text-ink">{booking.reference || 'No reference'}</p><p className="mt-1 text-sm text-muted">{booking.service_date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${booking.service_date}T00:00:00Z`)) : 'Departure not set'}{booking.supplier_id && suppliers[booking.supplier_id] ? ` · ${suppliers[booking.supplier_id]}` : ''}</p></div>
        <div className="shrink-0 text-right"><p className="bdm-num text-xl font-extrabold">{formatMinor(booking.commission_expected_minor, booking.currency, { showMinor: true })}</p><span className={s === 'paid' ? 'bdm-badge-positive' : s === 'needs_attention' ? 'bdm-badge-negative' : 'bdm-badge-caution'}>{s === 'paid' ? 'PAID' : s === 'needs_attention' ? 'NEEDS ATTENTION' : 'PENDING'}</span></div>
      </li>;
    })}</ul>
    {filtered.length === 0 && <div className="bdm-card p-6 text-center text-sm text-muted">No bookings match these filters.</div>}
  </section>;
}

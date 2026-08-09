import Link from 'next/link';
import { formatMinor } from '@/lib/domain/money';
import TravelBookingLedger from './TravelBookingLedger';

export default function TravelDashboard({ business, pipeline, suppliers }: {
  business: { id: string; name: string; currency: string };
  pipeline: {
    bookings: Array<{ id: string; reference: string | null; service_date: string | null; supplier_id: string | null; commission_expected_minor: number; commission_received_minor: number; currency: string }>;
    pendingMinor: number; paidMinor: number; upcomingPending: unknown[]; completedPending: unknown[];
    needsAttentionCount: number; attentionBookingIds: string[]; averageExpectedMinor: number;
    excludedCurrencyCount: number;
    byDepartureMonth: Array<{ month: string; paidMinor: number; pendingMinor: number }>;
  };
  suppliers: Record<string, string>;
}) {
  const fmt = (value: number) => formatMinor(value, business.currency, { showMinor: true });
  const max = Math.max(1, ...pipeline.byDepartureMonth.flatMap((m) => [m.paidMinor, m.pendingMinor]));
  return <div className="bdm-page space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="bdm-eyebrow">{business.name}</p><h1 className="bdm-h1">Travel commission command</h1></div><div className="flex flex-wrap gap-2"><Link className="bdm-btn-gold" href={`/b/${business.id}/money-in/new`}>+ Add booking</Link><Link className="bdm-btn-secondary" href={`/b/${business.id}/commission-reports/new`}>Upload commission report</Link><Link className="bdm-btn-secondary" href={`/b/${business.id}/zylx`}>Ask Zylx</Link></div></header>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Travel commission summary">
      <Card label="Money received" value={fmt(pipeline.paidMinor)} hint="Evidence-backed" />
      <Card label="Pending commission" value={fmt(pipeline.pendingMinor)} hint={pipeline.excludedCurrencyCount ? `Expected in ${business.currency}; ${pipeline.excludedCurrencyCount} other-currency booking(s) excluded` : 'Expected, not guaranteed'} caution={pipeline.pendingMinor > 0} />
      <Card label="Upcoming / completed" value={String(pipeline.upcomingPending.length + pipeline.completedPending.length)} hint={`${pipeline.completedPending.length} completed still pending`} />
      <Card label="Needs attention" value={String(pipeline.needsAttentionCount)} hint="Unresolved report issues" caution={pipeline.needsAttentionCount > 0} />
    </section>
    {pipeline.byDepartureMonth.length > 0 && <section className="bdm-card p-5"><div className="flex items-baseline justify-between"><h2 className="bdm-h2">Paid vs pending by departure month</h2><span className="text-xs text-muted">Average expected {fmt(pipeline.averageExpectedMinor)}</span></div><div className="mt-5 flex h-40 items-end gap-3 overflow-x-auto">{pipeline.byDepartureMonth.slice(-12).map((month) => <div key={month.month} className="flex h-full min-w-12 flex-1 flex-col items-center justify-end"><div className="flex h-full items-end gap-1"><div title={`Paid ${fmt(month.paidMinor)}`} className="w-4 rounded-t bg-positive" style={{ height: `${Math.max(2, month.paidMinor / max * 100)}%` }} /><div title={`Pending ${fmt(month.pendingMinor)}`} className="w-4 rounded-t bg-gold" style={{ height: `${Math.max(2, month.pendingMinor / max * 100)}%` }} /></div><span className="mt-2 text-[11px] text-muted">{month.month.slice(5)}</span></div>)}</div><div className="mt-3 flex gap-4 text-xs text-muted"><span>■ Paid</span><span className="text-gold-dark">■ Pending</span></div></section>}
    {pipeline.bookings.length === 0 ? <div className="bdm-card p-7 text-center"><h2 className="bdm-h2">Add your first booking</h2><p className="bdm-sub mt-2">Track expected commission now; record income only when a report proves payment.</p><Link className="bdm-btn-gold mt-5" href={`/b/${business.id}/money-in/new`}>+ Add booking</Link></div> : <TravelBookingLedger bookings={pipeline.bookings} suppliers={suppliers} attentionBookingIds={pipeline.attentionBookingIds} />}
  </div>;
}

function Card({ label, value, hint, caution }: { label: string; value: string; hint: string; caution?: boolean }) { return <div className="bdm-card p-4"><p className="bdm-eyebrow">{label}</p><p className={`bdm-figure-xl mt-1.5 ${caution ? 'text-caution' : ''}`}>{value}</p><p className="mt-1 text-xs text-muted">{hint}</p></div>; }

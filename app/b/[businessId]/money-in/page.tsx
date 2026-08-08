import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { listBookings } from '@/lib/services/bookings';
import { formatMinor } from '@/lib/domain/money';
import BookingList from '@/components/bdm/BookingList';
import { nounFor } from '@/lib/domain/nouns';

export const dynamic = 'force-dynamic';

export default async function MoneyInPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'viewer');
  const noun = nounFor(ctx.business.business_type);
  const currency = ctx.business.base_currency;
  const { bookings, totalOutstandingMinor, totalVolumeMinor, totalEarnedMinor } =
    await listBookings(ctx);

  const base = `/b/${ctx.businessId}`;
  const outstanding = bookings.filter((b) => b.outstanding_minor > 0);
  const paid = bookings.filter((b) => b.outstanding_minor === 0);

  if (bookings.length === 0) {
    return (
      <div className="bdm-page max-w-xl">
        <div className="bdm-card p-7 text-center">
          <h1 className="bdm-h1">{noun.plural}</h1>
          <p className="bdm-sub mx-auto mt-3 max-w-sm">
            Track what you sold and what you actually earn from it. A {noun.singular.toLowerCase()} worth
            $6,000 that earns you $600 shows as $600 of revenue — never $6,000.
          </p>
          <Link href={`${base}/money-in/new`} className="bdm-btn-gold mt-6">
            Add your first {noun.singular.toLowerCase()}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bdm-page space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">{noun.plural}</h1>
        </div>
        <Link href={`${base}/money-in/new`} className="bdm-btn-gold">
          + Add {noun.singular.toLowerCase()}
        </Link>
      </header>

      {/* The answer first: what you're waiting on. */}
      <section className="bdm-card p-5" aria-label="Summary">
        <p className="bdm-eyebrow">Still owed to you</p>
        <p className={`bdm-figure-xl mt-1.5 ${totalOutstandingMinor > 0 ? 'text-caution' : ''}`}>
          {formatMinor(totalOutstandingMinor, currency)}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-gold-line pt-3">
          <span>
            <span className="bdm-eyebrow block">You&apos;ve earned</span>
            <span className="bdm-num text-[15px] font-bold text-ink">{formatMinor(totalEarnedMinor, currency)}</span>
          </span>
          <span>
            <span className="bdm-eyebrow block">{noun.singular} volume</span>
            <span className="bdm-num text-[15px] font-bold text-muted">{formatMinor(totalVolumeMinor, currency)}</span>
          </span>
        </div>
      </section>

      {outstanding.length > 0 && (
        <section aria-label={`${noun.plural} awaiting payment`}>
          <h2 className="bdm-h2 mb-2.5">Waiting on payment</h2>
          <BookingList businessId={ctx.businessId} bookings={outstanding} currency={currency} noun={noun} />
        </section>
      )}

      {paid.length > 0 && (
        <section aria-label={`Settled ${noun.plural.toLowerCase()}`}>
          <h2 className="bdm-h2 mb-2.5">Settled</h2>
          <BookingList businessId={ctx.businessId} bookings={paid} currency={currency} noun={noun} />
        </section>
      )}
    </div>
  );
}

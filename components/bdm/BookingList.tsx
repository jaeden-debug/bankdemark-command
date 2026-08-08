'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMinor } from '@/lib/domain/money';

export interface BookingItem {
  id: string;
  description: string | null;
  reference: string | null;
  client_name: string | null;
  brand_name: string | null;
  gross_value_minor: number;
  commission_expected_minor: number;
  commission_received_minor: number;
  service_fee_minor: number;
  outstanding_minor: number;
  commission_status: string;
  booking_date: string;
  currency: string;
}

/**
 * Marking a commission received is ONE tap. No modal, no form, no
 * second screen. The row settles in place and the ledger updates
 * behind it, because chasing a payment you already got shouldn't cost
 * five clicks.
 */
export default function BookingList({
  businessId,
  bookings,
  currency,
  noun,
}: {
  businessId: string;
  bookings: BookingItem[];
  currency: string;
  noun: { singular: string; plural: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function markReceived(booking: BookingItem) {
    setPending(booking.id);
    setError(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, action: 'received', bookingId: booking.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not record that.');
      setSettled((prev) => new Set(prev).add(booking.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    } finally {
      setPending(null);
    }
  }

  if (bookings.length === 0) return null;

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {bookings.map((b) => {
          const justSettled = settled.has(b.id);
          const owed = justSettled ? 0 : b.outstanding_minor;
          const earns = b.commission_expected_minor + b.service_fee_minor;

          return (
            <li key={b.id} className="bdm-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold text-ink">
                    {b.description || 'Untitled'}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {[b.client_name, b.brand_name, b.booking_date].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="bdm-num text-[17px] font-extrabold text-ink">
                    {formatMinor(earns, currency)}
                  </p>
                  <p className="text-[11px] text-muted">
                    of {formatMinor(b.gross_value_minor, currency)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {owed > 0 ? (
                  <span className="bdm-badge-caution">
                    {formatMinor(owed, currency)} still owed
                  </span>
                ) : (
                  <span className="bdm-badge-positive">Paid</span>
                )}

                {owed > 0 && (
                  <button
                    type="button"
                    onClick={() => markReceived(b)}
                    disabled={pending === b.id}
                    className="bdm-btn-secondary bdm-btn-sm"
                  >
                    {pending === b.id ? 'Recording…' : 'Mark received'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ============================================================
// BOOKINGS & COMMISSIONS
//
// A booking is a sale whose headline value is not what the business
// earns. Travel is the clearest case — a $6,000 trip earning $600 —
// but the same shape covers any referral or agency arrangement.
//
// Design rules that keep this simple for the owner:
//   - Client is free text. We find or create the counterparty.
//   - Commission status is DERIVED, never asked for.
//   - Marking a commission received does everything in one action:
//     records the payment, updates the booking, and puts the cash in
//     the ledger so the dashboard moves.
// ============================================================

import 'server-only';
import type { BusinessContext } from './context';
import { ServiceError, unwrap } from './errors';
import { recordAudit } from './audit';
import { parseMajorToMinor, applyRate } from '@/lib/domain/money';
import { recognizedRevenueForBooking, type RecognitionMode } from '@/lib/domain/semantics';
import { createTransaction } from './transactions';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateBookingInput {
  /** Free text. Matched to an existing client or created. */
  clientName?: string | null;
  supplierName?: string | null;
  description: string;
  reference?: string | null;
  /** Headline value of what was sold. */
  grossValueMajor: string | number;
  /** What the business earns. Provide this OR commissionRatePercent. */
  commissionMajor?: string | number | null;
  commissionRatePercent?: number | null;
  /** Extra fee charged directly to the client, on top of commission. */
  serviceFeeMajor?: string | number | null;
  bookingDate?: string;
  serviceDate?: string | null;
  brandId?: string | null;
  recognitionMode?: RecognitionMode;
  notes?: string | null;
}

export interface BookingRow {
  id: string;
  reference: string | null;
  description: string | null;
  client_id: string | null;
  brand_id: string | null;
  gross_value_minor: number;
  commission_expected_minor: number;
  commission_received_minor: number;
  service_fee_minor: number;
  commission_status: string;
  booking_date: string;
  service_date: string | null;
  currency: string;
  status: string;
}

/** Find an existing client by name, or create one. Keeps entry to one field. */
async function resolveCounterparty(
  ctx: BusinessContext,
  name: string | null | undefined,
  kind: 'customer' | 'supplier'
): Promise<string | null> {
  const clean = name?.trim();
  if (!clean) return null;

  const { data: existing, error: findError } = await ctx.db
    .from('counterparties')
    .select('id')
    .eq('business_id', ctx.businessId)
    .eq('kind', kind)
    .ilike('name', clean)
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw new ServiceError('internal', 'Could not look up that client.', {
      detail: findError.message,
      cause: findError,
    });
  }
  if (existing) return existing.id;

  const created = unwrap(
    await ctx.db
      .from('counterparties')
      .insert({ business_id: ctx.businessId, name: clean.slice(0, 200), kind })
      .select('id')
      .single(),
    'save that client'
  ) as { id: string };

  return created.id;
}

export async function createBooking(
  ctx: BusinessContext,
  input: CreateBookingInput
): Promise<BookingRow> {
  const currency = ctx.business.base_currency;

  const description = input.description?.trim();
  if (!description) throw new ServiceError('validation', 'Say what was sold.');

  const grossValueMinor = parseMajorToMinor(input.grossValueMajor ?? 0, currency);
  if (grossValueMinor < 0) throw new ServiceError('validation', 'The total value cannot be negative.');

  // Commission may be given as an amount or a rate. Whichever is
  // supplied, the other is derived — the form shows both live so the
  // owner never has to calculate anything.
  let commissionExpectedMinor: number;
  if (input.commissionMajor !== null && input.commissionMajor !== undefined && input.commissionMajor !== '') {
    commissionExpectedMinor = parseMajorToMinor(input.commissionMajor, currency);
  } else if (input.commissionRatePercent != null) {
    if (input.commissionRatePercent < 0 || input.commissionRatePercent > 100) {
      throw new ServiceError('validation', 'The commission rate should be between 0 and 100%.');
    }
    commissionExpectedMinor = applyRate(grossValueMinor, input.commissionRatePercent / 100);
  } else {
    commissionExpectedMinor = 0;
  }

  if (commissionExpectedMinor < 0) {
    throw new ServiceError('validation', 'Commission cannot be negative.');
  }
  if (commissionExpectedMinor > grossValueMinor && grossValueMinor > 0) {
    throw new ServiceError(
      'validation',
      'Commission is more than the total sale value. Check the two amounts.'
    );
  }

  const serviceFeeMinor = input.serviceFeeMajor
    ? parseMajorToMinor(input.serviceFeeMajor, currency)
    : 0;

  const bookingDate = input.bookingDate ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(bookingDate)) throw new ServiceError('validation', 'Enter a valid date.');

  const [clientId, supplierId] = await Promise.all([
    resolveCounterparty(ctx, input.clientName, 'customer'),
    resolveCounterparty(ctx, input.supplierName, 'supplier'),
  ]);

  const row = unwrap(
    await ctx.db
      .from('bookings')
      .insert({
        business_id: ctx.businessId,
        reference: input.reference?.trim() || null,
        description: description.slice(0, 500),
        client_id: clientId,
        supplier_id: supplierId,
        brand_id: input.brandId || null,
        gross_value_minor: grossValueMinor,
        currency,
        booking_date: bookingDate,
        service_date: input.serviceDate || null,
        recognition_mode: input.recognitionMode ?? 'commission',
        commission_rate: input.commissionRatePercent != null ? input.commissionRatePercent / 100 : null,
        commission_expected_minor: commissionExpectedMinor,
        service_fee_minor: serviceFeeMinor,
        // Derived, not asked: nothing received yet means it is owed.
        commission_status: commissionExpectedMinor > 0 ? 'receivable' : 'earned',
        notes: input.notes?.slice(0, 2000) ?? null,
        created_by: ctx.userId,
      })
      .select('*')
      .single(),
    'save that booking'
  ) as unknown as BookingRow;

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    entity: 'booking',
    entityId: row.id,
    action: 'create',
    after: row,
    source: 'manual',
  });

  return row;
}

/**
 * Record that commission money actually arrived.
 *
 * One action does three things so the owner never has to remember the
 * second step: logs the payment, lets the booking trigger recompute
 * its own status, and puts the cash into the ledger tagged with the
 * booking's gross value — so revenue reflects the commission while
 * booking volume reflects the sale.
 */
export async function recordCommissionReceived(
  ctx: BusinessContext,
  bookingId: string,
  options: { accountId?: string; amountMajor?: string | number; receivedOn?: string } = {}
): Promise<{ transactionId: string | null; amountMinor: number }> {
  const currency = ctx.business.base_currency;

  const booking = unwrap(
    await ctx.db
      .from('bookings')
      .select('id, description, gross_value_minor, commission_expected_minor, commission_received_minor, service_fee_minor, brand_id, client_id, currency')
      .eq('id', bookingId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that booking'
  ) as {
    id: string; description: string | null; gross_value_minor: number;
    commission_expected_minor: number; commission_received_minor: number;
    service_fee_minor: number; brand_id: string | null; client_id: string | null; currency: string;
  };

  const outstanding = Math.max(
    0,
    booking.commission_expected_minor - booking.commission_received_minor
  );

  const amountMinor =
    options.amountMajor !== undefined && options.amountMajor !== ''
      ? parseMajorToMinor(options.amountMajor, currency)
      : outstanding;

  if (amountMinor <= 0) {
    throw new ServiceError('validation', 'There is nothing outstanding on this booking.');
  }

  const receivedOn = options.receivedOn ?? new Date().toISOString().slice(0, 10);

  // Pick the account for them when there is an obvious choice.
  let accountId = options.accountId;
  if (!accountId) {
    const { data: accounts } = await ctx.db
      .from('accounts')
      .select('id, account_kind')
      .eq('business_id', ctx.businessId)
      .eq('is_active', true)
      .order('created_at');
    accountId = accounts?.find((a) => a.account_kind === 'bank')?.id ?? accounts?.[0]?.id;
  }
  if (!accountId) {
    throw new ServiceError('validation', 'Add an account before recording money received.');
  }

  const transaction = await createTransaction(
    ctx,
    {
      accountId,
      occurredOn: receivedOn,
      amountMinor,
      description: `Commission — ${booking.description ?? 'booking'}`,
      transactionKind: 'commission',
      // The sale's headline value rides along so booking volume and
      // recognised revenue stay separable on the dashboard.
      grossAmountMinor: booking.gross_value_minor,
      recognizedAmountMinor: amountMinor,
      counterpartyId: booking.client_id,
      brandId: booking.brand_id,
      bookingId: booking.id,
    },
    { actorType: 'user', source: 'manual' }
  );

  const { error: paymentError } = await ctx.db.from('commission_payments').insert({
    business_id: ctx.businessId,
    booking_id: booking.id,
    transaction_id: transaction.id,
    amount_minor: amountMinor,
    currency,
    received_on: receivedOn,
    created_by: ctx.userId,
  });

  if (paymentError) {
    throw new ServiceError('internal', 'The payment could not be linked to the booking.', {
      detail: paymentError.message,
      cause: paymentError,
    });
  }

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    entity: 'booking',
    entityId: booking.id,
    action: 'commission_received',
    after: { amountMinor, receivedOn, transactionId: transaction.id },
    source: 'manual',
  });

  return { transactionId: transaction.id, amountMinor };
}

export interface BookingListItem extends BookingRow {
  client_name: string | null;
  brand_name: string | null;
  outstanding_minor: number;
}

export async function listBookings(
  ctx: BusinessContext,
  options: { status?: 'outstanding' | 'settled' | 'all'; limit?: number } = {}
): Promise<{ bookings: BookingListItem[]; totalOutstandingMinor: number; totalVolumeMinor: number; totalEarnedMinor: number }> {
  const { data, error } = await ctx.db
    .from('bookings')
    .select(
      'id, reference, description, client_id, brand_id, gross_value_minor, commission_expected_minor, commission_received_minor, service_fee_minor, commission_status, booking_date, service_date, currency, status'
    )
    .eq('business_id', ctx.businessId)
    .order('booking_date', { ascending: false })
    .limit(Math.min(options.limit ?? 200, 500));

  if (error) {
    throw new ServiceError('internal', 'Could not load bookings.', { detail: error.message, cause: error });
  }

  const rows = (data ?? []) as unknown as BookingRow[];

  const [{ data: clients }, { data: brands }] = await Promise.all([
    ctx.db.from('counterparties').select('id, name').eq('business_id', ctx.businessId),
    ctx.db.from('brands').select('id, name').eq('business_id', ctx.businessId),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name]));

  const enriched: BookingListItem[] = rows.map((b) => ({
    ...b,
    client_name: b.client_id ? clientName.get(b.client_id) ?? null : null,
    brand_name: b.brand_id ? brandName.get(b.brand_id) ?? null : null,
    outstanding_minor: ['cancelled', 'reversed'].includes(b.commission_status)
      ? 0
      : Math.max(0, b.commission_expected_minor - b.commission_received_minor),
  }));

  const filtered =
    options.status === 'outstanding'
      ? enriched.filter((b) => b.outstanding_minor > 0)
      : options.status === 'settled'
        ? enriched.filter((b) => b.outstanding_minor === 0)
        : enriched;

  return {
    bookings: filtered,
    totalOutstandingMinor: enriched.reduce((s, b) => s + b.outstanding_minor, 0),
    totalVolumeMinor: enriched.reduce((s, b) => s + b.gross_value_minor, 0),
    totalEarnedMinor: enriched.reduce(
      (s, b) =>
        s +
        recognizedRevenueForBooking({
          grossValueMinor: b.gross_value_minor,
          recognitionMode: 'commission',
          commissionExpectedMinor: b.commission_expected_minor,
          serviceFeeMinor: b.service_fee_minor,
        }),
      0
    ),
  };
}

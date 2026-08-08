import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { createBooking, recordCommissionReceived } from '@/lib/services/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(String(body.businessId), 'member');

    // One endpoint, two intents. Marking a commission received is the
    // most common action, so it stays a single round trip.
    if (body.action === 'received') {
      const result = await recordCommissionReceived(ctx, String(body.bookingId ?? ''), {
        amountMajor: body.amountMajor,
        receivedOn: body.receivedOn,
        accountId: body.accountId,
      });
      logEvent('booking.commission_received', { requestId, businessId: ctx.businessId });
      return NextResponse.json({ ok: true, ...result });
    }

    const booking = await createBooking(ctx, {
      clientName: body.clientName ?? null,
      supplierName: body.supplierName ?? null,
      description: String(body.description ?? ''),
      reference: body.reference ?? null,
      grossValueMajor: body.grossValueMajor ?? 0,
      commissionMajor: body.commissionMajor ?? null,
      commissionRatePercent:
        body.commissionRatePercent != null ? Number(body.commissionRatePercent) : null,
      serviceFeeMajor: body.serviceFeeMajor ?? null,
      bookingDate: body.bookingDate,
      serviceDate: body.serviceDate ?? null,
      brandId: body.brandId ?? null,
      notes: body.notes ?? null,
    });

    logEvent('booking.created', { requestId, businessId: ctx.businessId, bookingId: booking.id });
    return NextResponse.json({ ok: true, booking });
  } catch (error) {
    const e = toServiceError(error, 'save that booking');
    logError('bookings.write_failed', e, { requestId, route: '/api/bookings' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

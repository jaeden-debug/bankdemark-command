// ============================================================
// INVOICE PAYMENTS
//
// Recording a payment is never gated by plan. It settles a financial
// record the business already owns.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { recordInvoicePayment, reverseInvoicePayment } from '@/lib/services/invoices';
import { parseMajorToMinor } from '@/lib/domain/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(String(body.businessId), 'member');

    // Accept either exact minor units (machine callers) or a typed
    // major amount (a person). Never `Number(x) * 100`.
    let amountMinor: number;
    if (typeof body.amountMinor === 'number') {
      amountMinor = Math.trunc(body.amountMinor);
    } else if (body.amountMajor !== undefined && body.amountMajor !== '') {
      amountMinor = parseMajorToMinor(body.amountMajor, String(body.currency ?? 'CAD'));
    } else {
      throw new ServiceError('validation', 'Enter the amount received.');
    }

    const result = await recordInvoicePayment(
      ctx,
      params.invoiceId,
      {
        amountMinor,
        receivedOn: body.receivedOn,
        method: body.method ?? null,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        transactionId: body.transactionId ?? null,
      },
      { actorType: 'user', source: 'manual', requestId }
    );

    logEvent('invoice.payment_recorded', {
      requestId,
      businessId: ctx.businessId,
      invoiceId: params.invoiceId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const e = toServiceError(error, 'record that payment');
    logError('invoice.payment_failed', e, { requestId, route: '/api/invoices/[invoiceId]/payments' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    // The reason is written onto a financial record and can name people
    // or amounts, so it travels in the body rather than the query string.
    const body = await req.json().catch(() => ({}));
    const businessId = String(body?.businessId ?? req.nextUrl.searchParams.get('businessId') ?? '');
    const paymentId = String(body?.paymentId ?? req.nextUrl.searchParams.get('paymentId') ?? '');
    const reason = String(body?.reason ?? '');
    if (!businessId || !paymentId) {
      throw new ServiceError('validation', 'Missing business or payment.');
    }
    if (!reason.trim()) {
      throw new ServiceError('validation', 'Give a reason for reversing this payment.');
    }
    const ctx = await requireBusiness(businessId, 'member');
    const invoice = await reverseInvoicePayment(ctx, paymentId, reason, {
      actorType: 'user',
      source: 'manual',
      requestId,
    });
    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    const e = toServiceError(error, 'reverse that payment');
    logError('invoice.payment_reversal_failed', e, { requestId });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

// ============================================================
// INVOICES API — list and create
//
// Every write goes through lib/services/invoices.ts. This route is a
// thin transport shell: parse, delegate, map errors. No business rule
// lives here, so Zylx, MCP and any future standalone invoicing surface
// enforce exactly the same rules by calling the same service.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import {
  createInvoice,
  listInvoices,
  createInvoiceFromBooking,
  type ListInvoicesFilters,
} from '@/lib/services/invoices';
import type { InvoiceLineInput } from '@/lib/domain/invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const businessId = p.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(businessId, 'viewer');

    const filters: ListInvoicesFilters = {
      status: (p.get('status') as ListInvoicesFilters['status']) ?? undefined,
      counterpartyId: p.get('counterpartyId') ?? undefined,
      from: p.get('from') ?? undefined,
      to: p.get('to') ?? undefined,
      search: p.get('search') ?? undefined,
      page: Number(p.get('page')) || 1,
      pageSize: Number(p.get('pageSize')) || 50,
    };

    return NextResponse.json(await listInvoices(ctx, filters));
  } catch (error) {
    const e = toServiceError(error, 'load invoices');
    logError('invoices.list_failed', e, { route: '/api/invoices' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(String(body.businessId), 'member');

    // Draft an invoice for a booking's outstanding commission.
    if (body.fromBookingId) {
      const result = await createInvoiceFromBooking(ctx, String(body.fromBookingId), {
        actorType: 'user',
        source: 'manual',
        requestId,
      });
      logEvent('invoice.created_from_booking', {
        requestId,
        businessId: ctx.businessId,
        invoiceId: result.invoice.id,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const lines = Array.isArray(body.lines) ? (body.lines as InvoiceLineInput[]) : [];

    const result = await createInvoice(
      ctx,
      {
        counterpartyId: body.counterpartyId ?? null,
        sourceKind: body.sourceKind,
        bookingId: body.bookingId ?? null,
        projectId: body.projectId ?? null,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
        paymentTerms: body.paymentTerms,
        currency: body.currency,
        lines,
        discountKind: body.discountKind,
        discountValue: Number(body.discountValue) || 0,
        notes: body.notes ?? null,
        terms: body.terms ?? null,
        paymentInstructions: body.paymentInstructions ?? null,
        customFields: body.customFields ?? {},
      },
      { actorType: 'user', source: 'manual', requestId }
    );

    logEvent('invoice.created', {
      requestId,
      businessId: ctx.businessId,
      invoiceId: result.invoice.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const e = toServiceError(error, 'create that invoice');
    logError('invoices.create_failed', e, { requestId, route: '/api/invoices' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

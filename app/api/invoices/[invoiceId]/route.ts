// ============================================================
// A SINGLE INVOICE — read, edit a draft, delete a draft
//
// `action` on PATCH covers the lifecycle transitions (issue, void,
// revise, credit) so each one runs through its own service function
// with its own rules, rather than the client PUTting a status string.
// That is what makes "mark it paid without a payment" impossible.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import {
  getInvoice,
  updateInvoice,
  deleteDraftInvoice,
  issueInvoice,
  voidInvoice,
  reviseInvoice,
  createCreditNote,
  regenerateShareLink,
  revokeShareLink,
} from '@/lib/services/invoices';
import type { InvoiceLineInput } from '@/lib/domain/invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'viewer');
    return NextResponse.json(await getInvoice(ctx, params.invoiceId));
  } catch (error) {
    const e = toServiceError(error, 'load that invoice');
    logError('invoice.get_failed', e, { route: '/api/invoices/[invoiceId]' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(String(body.businessId), 'member');
    const id = params.invoiceId;
    const opts = { actorType: 'user' as const, source: 'manual' as const, requestId };

    switch (body.action) {
      case 'issue': {
        const invoice = await issueInvoice(ctx, id, opts);
        logEvent('invoice.issued', { requestId, businessId: ctx.businessId, invoiceId: id });
        return NextResponse.json({ ok: true, invoice });
      }
      case 'void': {
        const invoice = await voidInvoice(ctx, id, String(body.reason ?? ''), opts);
        logEvent('invoice.voided', { requestId, businessId: ctx.businessId, invoiceId: id });
        return NextResponse.json({ ok: true, invoice });
      }
      case 'revise': {
        const result = await reviseInvoice(ctx, id, String(body.reason ?? ''), opts);
        logEvent('invoice.revised', { requestId, businessId: ctx.businessId, invoiceId: id });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'credit_note': {
        const result = await createCreditNote(ctx, id, String(body.reason ?? ''), opts);
        logEvent('invoice.credited', { requestId, businessId: ctx.businessId, invoiceId: id });
        return NextResponse.json({ ok: true, ...result });
      }
      case 'regenerate_link': {
        const token = await regenerateShareLink(ctx, id, opts);
        return NextResponse.json({ ok: true, token });
      }
      case 'revoke_link': {
        await revokeShareLink(ctx, id, opts);
        return NextResponse.json({ ok: true });
      }
      case undefined:
      case 'update': {
        const result = await updateInvoice(
          ctx,
          id,
          {
            counterpartyId: body.counterpartyId,
            projectId: body.projectId,
            bookingId: body.bookingId,
            issueDate: body.issueDate,
            dueDate: body.dueDate,
            paymentTerms: body.paymentTerms,
            currency: body.currency,
            lines: Array.isArray(body.lines) ? (body.lines as InvoiceLineInput[]) : undefined,
            discountKind: body.discountKind,
            discountValue:
              body.discountValue !== undefined ? Number(body.discountValue) : undefined,
            notes: body.notes,
            terms: body.terms,
            paymentInstructions: body.paymentInstructions,
            customFields: body.customFields,
          },
          opts
        );
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        throw new ServiceError('validation', `Unknown action: ${String(body.action)}`);
    }
  } catch (error) {
    const e = toServiceError(error, 'update that invoice');
    logError('invoice.patch_failed', e, { requestId, route: '/api/invoices/[invoiceId]' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  const requestId = crypto.randomUUID();
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'member');

    // Only ever deletes a draft. An issued invoice is refused by the
    // service AND by a database trigger.
    await deleteDraftInvoice(ctx, params.invoiceId, {
      actorType: 'user',
      source: 'manual',
      requestId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const e = toServiceError(error, 'delete that draft');
    logError('invoice.delete_failed', e, { requestId, route: '/api/invoices/[invoiceId]' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

// ============================================================
// CONFIRM A DOCUMENT
//
// Turns an extraction into a real transaction, or attaches the document
// to one that already exists.
//
// The submitted values are treated as the USER'S, not the model's. They
// arrive from a form the person has just read and edited, so the
// resulting record is `confirmed_by_user: true` — but the provenance
// still records that a machine read it first, and how confident it was.
// That distinction is what makes the books auditable later.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { assertOwned } from '@/lib/services/ownership';
import { createTransaction } from '@/lib/services/transactions';
import { recordAudit } from '@/lib/services/audit';
import { TRANSACTION_KINDS, type TransactionKind } from '@/lib/domain/semantics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    if (!body?.documentId) throw new ServiceError('validation', 'Missing document.');

    const ctx = await requireBusiness(String(body.businessId), 'member');

    // Every referenced id is re-checked against this business.
    await assertOwned(ctx, 'documents', String(body.documentId));

    // ── Attach to an existing transaction ─────────────────
    //
    // The duplicate case. No new financial record is created; the
    // receipt simply becomes evidence for one already in the books.
    if (body.action === 'attach') {
      const transactionId = String(body.transactionId ?? '');
      await assertOwned(ctx, 'transactions', transactionId);

      const { error: txError } = await ctx.db
        .from('transactions')
        .update({ document_id: String(body.documentId) })
        .eq('id', transactionId)
        .eq('business_id', ctx.businessId);

      if (txError) {
        throw new ServiceError('internal', 'Could not attach that receipt.', { detail: txError.message });
      }

      const { error: docError } = await ctx.db
        .from('documents')
        .update({
          status: 'matched',
          matched_transaction_id: transactionId,
          confirmed_by: ctx.userId,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', String(body.documentId))
        .eq('business_id', ctx.businessId);

      if (docError) {
        throw new ServiceError('internal', 'Could not attach that receipt.', { detail: docError.message });
      }

      await recordAudit(ctx.db, {
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entity: 'document',
        entityId: String(body.documentId),
        action: 'attach_to_transaction',
        after: { transactionId },
        source: 'manual',
      });

      logEvent('document.attached', { requestId, businessId: ctx.businessId, transactionId });
      return NextResponse.json({ ok: true, attached: true, transactionId });
    }

    // ── Create a new transaction from the document ────────
    const kind = String(body.transactionKind ?? 'expense') as TransactionKind;
    if (!TRANSACTION_KINDS.includes(kind)) {
      throw new ServiceError('validation', 'That transaction type is not valid.');
    }

    await assertOwned(ctx, 'accounts', body.accountId ? String(body.accountId) : null);
    await assertOwned(ctx, 'categories', body.categoryId ? String(body.categoryId) : null);
    await assertOwned(ctx, 'brands', body.brandId ? String(body.brandId) : null);

    const outbound: TransactionKind[] = [
      'expense', 'owner_draw', 'loan_payment', 'credit_card_payment',
      'refund', 'asset_purchase', 'tax_payment',
    ];

    const row = await createTransaction(
      ctx,
      {
        accountId: String(body.accountId ?? ''),
        occurredOn: String(body.occurredOn ?? ''),
        amountMajor: body.amountMajor,
        direction: outbound.includes(kind) ? 'out' : 'in',
        description: String(body.description ?? ''),
        merchant: body.merchant ? String(body.merchant) : null,
        transactionKind: kind,
        categoryId: body.categoryId || null,
        brandId: body.brandId || null,
        documentId: String(body.documentId),
        sourceDocumentId: String(body.documentId),
        extractionMethod: 'ai_vision',
        extractionConfidence:
          typeof body.extractionConfidence === 'number' ? body.extractionConfidence : null,
        // The person reviewed and submitted this form, so the figures
        // are theirs now — even though a machine proposed them.
        confirmedByUser: true,
      },
      { actorType: 'user', source: 'manual', requestId }
    );

    const { error: docError } = await ctx.db
      .from('documents')
      .update({
        status: 'matched',
        matched_transaction_id: row.id,
        confirmed_by: ctx.userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', String(body.documentId))
      .eq('business_id', ctx.businessId);

    if (docError) {
      // The transaction exists and the user was told it would. Log the
      // link failure rather than failing a completed write.
      logError('document.link_failed', docError, { requestId, transactionId: row.id });
    }

    logEvent('document.confirmed', {
      requestId,
      businessId: ctx.businessId,
      documentId: String(body.documentId),
      transactionId: row.id,
    });

    return NextResponse.json({ ok: true, transaction: row });
  } catch (error) {
    const e = toServiceError(error, 'record that document');
    logError('documents.confirm_failed', e, { requestId, route: '/api/documents/confirm' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

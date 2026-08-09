// ============================================================
// APPROVE A ZYLX PROPOSAL
//
// Zylx can never write to the ledger. It produces a proposal; this
// route is what turns an approved proposal into a real transaction,
// through the same service every other caller uses, with an audit
// entry recording that Zylx originated it and the user approved it.
//
// The proposal is re-validated here. A proposal is a client-supplied
// object and is treated as untrusted input, not as a signed intent.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { isEnabled } from '@/lib/services/entitlements';
import { createTransaction, bulkCategorize } from '@/lib/services/transactions';
import { createInvoice } from '@/lib/services/invoices';
import type { BusinessContext } from '@/lib/services/context';
import { TRANSACTION_KINDS, type TransactionKind } from '@/lib/domain/semantics';
import { createHash } from 'node:crypto';
import { assertOwned, assertTransactionsOwned } from '@/lib/services/ownership';
import { createBooking } from '@/lib/services/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const body = (await req.json()) as {
      businessId?: string;
      proposal?: {
        kind?: string;
        transactionKind?: string;
        amountMajor?: number;
        occurredOn?: string;
        description?: string;
        merchant?: string;
        accountId?: string;
        categoryId?: string;
      };
    };

    if (!body.businessId) throw new ServiceError('validation', 'Missing business.');
    const proposal = body.proposal;
    const KNOWN_KINDS = ['transaction', 'invoice_draft', 'categorize', 'booking'];
    if (!proposal || !KNOWN_KINDS.includes(String(proposal.kind))) {
      throw new ServiceError('validation', 'That proposal is not something I can record.');
    }

    // `member` and above — a viewer or accountant cannot write.
    const ctx = await requireBusiness(body.businessId, 'member');

    const { data: profile } = await ctx.db
      .from('profiles').select('plan').eq('id', ctx.userId).single();
    if (!isEnabled(profile?.plan ?? 'free', 'ai_writes')) {
      throw new ServiceError('forbidden', 'Zylx actions are not included in your plan.');
    }

    // ── Idempotency ──
    //
    // A proposal is content-addressed: the same business, user and
    // proposal payload always produce the same key. A double-click, a
    // retry after a timeout, or a refresh replays the ORIGINAL result
    // instead of creating a second financial record.
    //
    // Deliberately content-based, not a random token: the client cannot
    // defeat it by generating a fresh id. Genuinely repeating a real
    // transaction stays possible — change any field (amount, date,
    // description) and the key differs.
    const idempotencyKey = proposalKey(ctx.businessId, ctx.userId, proposal);

    const { data: prior } = await ctx.db
      .from('zylx_approvals')
      .select('result_kind, result_id, result, created_at')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (prior) {
      logEvent('zylx.approve_replayed', {
        requestId,
        businessId: ctx.businessId,
        userId: ctx.userId,
        resultId: prior.result_id ?? undefined,
      });
      return NextResponse.json({
        ok: true,
        idempotent: true,
        alreadyRecordedAt: prior.created_at,
        ...(prior.result as Record<string, unknown> | null),
      });
    }

    // ── Bulk categorisation ──
    //
    // financial_write: reclassifies existing records. Ownership of every
    // id is re-established here — the proposal is client-supplied and
    // could have been edited after Zylx produced it.
    if (proposal.kind === 'categorize') {
      const ids = Array.isArray((proposal as Record<string, unknown>).transactionIds)
        ? ((proposal as Record<string, unknown>).transactionIds as unknown[]).map(String)
        : [];
      const categoryId = String((proposal as Record<string, unknown>).categoryId ?? '');

      const owned = await assertTransactionsOwned(ctx, ids);
      await assertOwned(ctx, 'categories', categoryId);

      const changed = await bulkCategorize(ctx, owned, categoryId, {
        actorType: 'zylx',
        source: 'zylx',
        requestId,
      });

      await recordApproval(ctx, idempotencyKey, 'categorize', 'transactions', null, {
        categorizedCount: changed,
      });

      logEvent('zylx.categorize_approved', {
        requestId, businessId: ctx.businessId, userId: ctx.userId, count: changed,
      });
      return NextResponse.json({ ok: true, categorizedCount: changed });
    }

    if (proposal.kind === 'booking') {
      if (ctx.business.business_type !== 'travel') throw new ServiceError('validation', 'This is not a travel business.');
      const rawBookings = Array.isArray((proposal as Record<string, unknown>).bookings)
        ? (proposal as Record<string, unknown>).bookings as Array<Record<string, unknown>> : [];
      if (!rawBookings.length || rawBookings.length > 50) throw new ServiceError('validation', 'That booking proposal is empty or too large.');
      const created = [];
      for (const item of rawBookings) {
        const reference = String(item.reference ?? '').trim(); const commissionMajor = Number(item.commissionMajor);
        if (!reference || !Number.isFinite(commissionMajor) || commissionMajor <= 0) throw new ServiceError('validation', 'Every booking needs a reference and positive commission.');
        created.push(await createBooking(ctx, {
          reference, commissionMajor, grossValueMajor: 0, description: `Booking ${reference}`,
          serviceDate: typeof item.departureDate === 'string' ? item.departureDate : null,
          returnDate: typeof item.returnDate === 'string' ? item.returnDate : null,
          clientName: typeof item.clientName === 'string' ? item.clientName : null,
          supplierName: typeof item.supplierName === 'string' ? item.supplierName : null,
          hostAgencyName: typeof item.hostAgencyName === 'string' ? item.hostAgencyName : null,
          notes: typeof item.notes === 'string' ? item.notes : null, source: 'zylx',
        }));
      }
      await recordApproval(ctx, idempotencyKey, 'booking', 'bookings', created[0]?.id ?? null, { bookings: created });
      return NextResponse.json({ ok: true, bookings: created });
    }

    // ── Invoice drafts ──
    //
    // Approving creates a DRAFT and nothing more. Issuing assigns the
    // permanent number and freezes the record; sending puts it in front
    // of a client. Both stay human actions, so an assistant can never
    // put a financial document in someone's inbox on its own.
    if (proposal.kind === 'invoice_draft') {
      const result = await createInvoiceFromProposal(ctx, proposal, requestId);
      await recordApproval(ctx, idempotencyKey, 'invoice_draft', 'invoice', result.invoice.id, {
        invoice: result.invoice,
        next: 'draft_created',
      });
      logEvent('zylx.invoice_draft_approved', {
        requestId,
        businessId: ctx.businessId,
        userId: ctx.userId,
        invoiceId: result.invoice.id,
      });
      return NextResponse.json({
        ok: true,
        invoice: result.invoice,
        next: 'draft_created',
        message:
          'Draft created. Review it, then issue it yourself — Zylx does not issue or send invoices.',
      });
    }

    const kind = proposal.transactionKind as TransactionKind;
    if (!TRANSACTION_KINDS.includes(kind)) {
      throw new ServiceError('validation', 'That transaction type is not valid.');
    }
    if (!proposal.accountId) {
      throw new ServiceError('validation', 'Choose which account this went through.');
    }
    const amountMajor = Number(proposal.amountMajor);
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      throw new ServiceError('validation', 'Amount must be a positive number.');
    }

    // Money out kinds must be recorded as negative movements.
    const outbound: TransactionKind[] = [
      'expense', 'owner_draw', 'loan_payment', 'credit_card_payment',
      'refund', 'asset_purchase', 'tax_payment',
    ];
    const direction: 'in' | 'out' = outbound.includes(kind) ? 'out' : 'in';

    const row = await createTransaction(
      ctx,
      {
        accountId: proposal.accountId,
        occurredOn: String(proposal.occurredOn ?? ''),
        amountMajor,
        direction,
        description: String(proposal.description ?? ''),
        merchant: proposal.merchant ?? null,
        transactionKind: kind,
        categoryId: proposal.categoryId ?? null,
      },
      { actorType: 'zylx', source: 'zylx', requestId }
    );

    logEvent('zylx.proposal_approved', {
      requestId,
      businessId: ctx.businessId,
      userId: ctx.userId,
      transactionId: row.id,
      kind,
    });

    await recordApproval(ctx, idempotencyKey, 'transaction', 'transaction', row.id, { transaction: row });

    return NextResponse.json({ ok: true, transaction: row });
  } catch (error) {
    const serviceError = toServiceError(error, 'record that transaction');
    logError('zylx.approve_failed', serviceError, { requestId, route: '/api/zylx/approve' });
    return NextResponse.json(serviceError.toJSON(), { status: serviceError.status });
  }
}

// ============================================================
// INVOICE DRAFT FROM AN APPROVED PROPOSAL
//
// The proposal is client-supplied and therefore untrusted. Every field
// is re-validated here and the invoice is built through the normal
// invoice service, so quota, audit and the immutability rules apply
// exactly as they would to a human-created invoice.
// ============================================================

interface InvoiceProposalLine {
  description?: unknown;
  quantity?: unknown;
  unitPriceMinor?: unknown;
  taxCode?: unknown;
  taxLabel?: unknown;
  taxRate?: unknown;
  taxTreatment?: unknown;
}

async function createInvoiceFromProposal(
  ctx: BusinessContext,
  proposal: Record<string, unknown>,
  requestId: string
) {
  const rawLines = Array.isArray(proposal.lines) ? (proposal.lines as InvoiceProposalLine[]) : [];
  if (rawLines.length === 0) {
    throw new ServiceError('validation', 'That invoice proposal has no line items.');
  }
  if (rawLines.length > 200) {
    throw new ServiceError('validation', 'That proposal has too many line items.');
  }

  const lines = rawLines.map((l, i) => {
    const description = String(l.description ?? '').trim();
    if (!description) throw new ServiceError('validation', `Line ${i + 1} has no description.`);

    const quantity = Number(l.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw new ServiceError('validation', `Line ${i + 1} has an invalid quantity.`);
    }

    const unitPriceMinor = Math.trunc(Number(l.unitPriceMinor ?? 0));
    if (!Number.isSafeInteger(unitPriceMinor)) {
      throw new ServiceError('validation', `Line ${i + 1} has an invalid amount.`);
    }

    const taxRate = Number(l.taxRate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
      throw new ServiceError('validation', `Line ${i + 1} has an invalid tax rate.`);
    }

    const treatment = String(l.taxTreatment ?? 'standard');
    const allowed = ['standard', 'zero_rated', 'exempt', 'out_of_scope'];
    if (!allowed.includes(treatment)) {
      throw new ServiceError('validation', `Line ${i + 1} has an unknown tax treatment.`);
    }

    return {
      description,
      quantity,
      unitPriceMinor,
      taxCode: l.taxCode ? String(l.taxCode) : null,
      taxLabel: l.taxLabel ? String(l.taxLabel) : null,
      taxRate,
      taxTreatment: treatment as 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope',
    };
  });

  // Ids are re-checked against this business by the invoice service.
  const counterpartyId =
    typeof proposal.counterpartyId === 'string' ? proposal.counterpartyId : null;
  const bookingId = typeof proposal.bookingId === 'string' ? proposal.bookingId : null;

  const customFields =
    proposal.customFields && typeof proposal.customFields === 'object'
      ? (proposal.customFields as Record<string, unknown>)
      : {};

  return createInvoice(
    ctx,
    {
      counterpartyId,
      bookingId,
      sourceKind: bookingId ? 'commission' : 'manual',
      dueDate: typeof proposal.dueDate === 'string' ? proposal.dueDate : undefined,
      currency: typeof proposal.currency === 'string' ? proposal.currency : undefined,
      lines,
      notes: typeof proposal.notes === 'string' ? proposal.notes : null,
      customFields,
    },
    { actorType: 'zylx', source: 'zylx', requestId }
  );
}


// ============================================================
// IDEMPOTENCY
// ============================================================

/**
 * Stable key for an approved proposal.
 *
 * Hashes business + user + the proposal's meaningful fields with sorted
 * keys, so property order and any client-only decoration cannot change
 * the result.
 */
function proposalKey(businessId: string, userId: string, proposal: unknown): string {
  return createHash('sha256')
    .update(`${businessId}|${userId}|${stableStringify(proposal)}`)
    .digest('hex')
    .slice(0, 48);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k]) => k !== 'summary' && k !== 'warnings') // presentation only
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Journal the execution. Never throws: the financial record is already
 * committed and the user has been told it succeeded, so failing here
 * must not turn a success into an error. It is logged loudly instead —
 * the cost of a miss is one possible duplicate, not lost money.
 */
async function recordApproval(
  ctx: BusinessContext,
  idempotencyKey: string,
  proposalKind: string,
  resultKind: string,
  resultId: string | null,
  result: Record<string, unknown>
): Promise<void> {
  const { error } = await ctx.db.from('zylx_approvals').insert({
    idempotency_key: idempotencyKey,
    business_id: ctx.businessId,
    user_id: ctx.userId,
    proposal_kind: proposalKind,
    result_kind: resultKind,
    result_id: resultId,
    result: result as never,
  });
  if (error) {
    logError('zylx.approval_journal_failed', error, {
      businessId: ctx.businessId,
      idempotencyKey,
    });
  }
}

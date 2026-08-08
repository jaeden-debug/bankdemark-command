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
import { createTransaction } from '@/lib/services/transactions';
import { TRANSACTION_KINDS, type TransactionKind } from '@/lib/domain/semantics';

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
    if (!proposal || proposal.kind !== 'transaction') {
      throw new ServiceError('validation', 'That proposal is not something I can record.');
    }

    // `member` and above — a viewer or accountant cannot write.
    const ctx = await requireBusiness(body.businessId, 'member');

    const { data: profile } = await ctx.db
      .from('profiles').select('plan').eq('id', ctx.userId).single();
    if (!isEnabled(profile?.plan ?? 'free', 'ai_writes')) {
      throw new ServiceError('forbidden', 'Zylx actions are not included in your plan.');
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

    return NextResponse.json({ ok: true, transaction: row });
  } catch (error) {
    const serviceError = toServiceError(error, 'record that transaction');
    logError('zylx.approve_failed', serviceError, { requestId, route: '/api/zylx/approve' });
    return NextResponse.json(serviceError.toJSON(), { status: serviceError.status });
  }
}

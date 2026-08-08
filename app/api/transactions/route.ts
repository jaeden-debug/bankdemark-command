import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { logError, logEvent, toServiceError, ServiceError } from '@/lib/services/errors';
import {
  createTransaction,
  createTransfer,
  listTransactions,
  type ListTransactionsFilters,
} from '@/lib/services/transactions';
import type { TransactionKind } from '@/lib/domain/semantics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const businessId = p.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(businessId, 'viewer');

    const filters: ListTransactionsFilters = {
      from: p.get('from') ?? undefined,
      to: p.get('to') ?? undefined,
      accountId: p.get('accountId') ?? undefined,
      categoryId: p.get('categoryId') ?? undefined,
      kind: (p.get('kind') as ListTransactionsFilters['kind']) ?? undefined,
      reviewStatus: (p.get('reviewStatus') as ListTransactionsFilters['reviewStatus']) ?? undefined,
      search: p.get('search') ?? undefined,
      page: Number(p.get('page')) || 1,
      pageSize: Number(p.get('pageSize')) || 50,
    };

    return NextResponse.json(await listTransactions(ctx, filters));
  } catch (error) {
    const e = toServiceError(error, 'load transactions');
    logError('transactions.list_failed', e, { route: '/api/transactions' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(String(body.businessId), 'member');

    // Transfers are always created as a matched pair so half a transfer
    // can never exist and inflate revenue.
    if (body.mode === 'transfer') {
      const result = await createTransfer(
        ctx,
        {
          fromAccountId: String(body.fromAccountId ?? ''),
          toAccountId: String(body.toAccountId ?? ''),
          occurredOn: String(body.occurredOn ?? ''),
          amountMajor: body.amountMajor,
          description: body.description ? String(body.description) : undefined,
          isCreditCardPayment: Boolean(body.isCreditCardPayment),
        },
        { actorType: 'user', source: 'manual', requestId }
      );
      logEvent('transaction.transfer_created', { requestId, businessId: ctx.businessId });
      return NextResponse.json({ ok: true, transfer: result });
    }

    const kind = String(body.transactionKind ?? 'expense') as TransactionKind;
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
        counterpartyId: body.counterpartyId || null,
        projectId: body.projectId || null,
        brandId: body.brandId || null,
        grossAmountMinor:
          body.grossAmountMajor != null
            ? Math.round(Number(body.grossAmountMajor) * 100)
            : null,
        notes: body.notes ? String(body.notes) : null,
      },
      { actorType: 'user', source: 'manual', requestId }
    );

    logEvent('transaction.created', { requestId, businessId: ctx.businessId, transactionId: row.id });
    return NextResponse.json({ ok: true, transaction: row });
  } catch (error) {
    const e = toServiceError(error, 'save that transaction');
    logError('transactions.create_failed', e, { requestId, route: '/api/transactions' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

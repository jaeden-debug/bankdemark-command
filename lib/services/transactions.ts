// ============================================================
// TRANSACTION WRITE SERVICE
//
// The only sanctioned path for mutating the ledger. Zylx, MCP, CSV
// import and the UI all go through here, so approval, validation,
// audit and transfer safety cannot be bypassed by any one caller.
// ============================================================

import 'server-only';
import { createHash } from 'node:crypto';
import type { BusinessContext } from './context';
import { ServiceError, assertOk, unwrap } from './errors';
import { recordAudit, diffRecords, type ActorType, type DataSource } from './audit';
import { assertSafeMinor, parseMajorToMinor } from '@/lib/domain/money';
import {
  TRANSACTION_KINDS,
  deriveRecognizedMinor,
  type TransactionKind,
} from '@/lib/domain/semantics';

export interface CreateTransactionInput {
  accountId: string;
  occurredOn: string;
  /** Signed minor units from the account's view. Provide this OR amountMajor. */
  amountMinor?: number;
  amountMajor?: string | number;
  /** When only a magnitude is known, `direction` gives it a sign. */
  direction?: 'in' | 'out';
  description: string;
  transactionKind: TransactionKind;
  categoryId?: string | null;
  counterpartyId?: string | null;
  merchant?: string | null;
  projectId?: string | null;
  brandId?: string | null;
  bookingId?: string | null;
  documentId?: string | null;
  grossAmountMinor?: number | null;
  recognizedAmountMinor?: number | null;
  notes?: string | null;
  externalId?: string | null;
  importBatchId?: string | null;
  raw?: unknown;
}

export interface WriteOptions {
  actorType?: ActorType;
  source?: DataSource;
  requestId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(ctx: BusinessContext, input: CreateTransactionInput): {
  amountMinor: number;
  occurredOn: string;
  kind: TransactionKind;
} {
  if (!ISO_DATE.test(input.occurredOn)) {
    throw new ServiceError('validation', 'Enter a valid date (YYYY-MM-DD).');
  }
  const parsedDate = new Date(`${input.occurredOn}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ServiceError('validation', 'That date is not a real date.');
  }
  // Guard against fat-fingered years that silently corrupt every report.
  const year = parsedDate.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 2) {
    throw new ServiceError('validation', `The year ${year} looks wrong. Check the date.`);
  }

  if (!TRANSACTION_KINDS.includes(input.transactionKind)) {
    throw new ServiceError('validation', `Unknown transaction type: ${input.transactionKind}`);
  }
  const kind = input.transactionKind;

  let amountMinor: number;
  if (typeof input.amountMinor === 'number') {
    amountMinor = input.amountMinor;
  } else if (input.amountMajor !== undefined) {
    amountMinor = parseMajorToMinor(input.amountMajor, ctx.business.base_currency);
  } else {
    throw new ServiceError('validation', 'An amount is required.');
  }

  if (input.direction) {
    const magnitude = Math.abs(amountMinor);
    amountMinor = input.direction === 'in' ? magnitude : -magnitude;
  }

  assertSafeMinor(amountMinor, 'transaction amount');
  if (amountMinor === 0) {
    throw new ServiceError('validation', 'A transaction cannot be for zero.');
  }

  // Catch sign/type mismatches before they poison a report rather than
  // silently "fixing" them behind the user's back.
  if (kind === 'income' && amountMinor < 0) {
    throw new ServiceError(
      'validation',
      'Money in cannot be a negative amount. If money left the account, use Money out or Refund.'
    );
  }
  if (kind === 'expense' && amountMinor > 0) {
    throw new ServiceError(
      'validation',
      'Money out cannot be a positive amount. If money came in, use Money in or Reimbursement.'
    );
  }
  if (!input.description?.trim()) {
    throw new ServiceError('validation', 'A description is required.');
  }

  return { amountMinor, occurredOn: input.occurredOn, kind };
}

/**
 * Deterministic fingerprint used to spot the same transaction arriving
 * twice from an import or a re-sync. Deliberately excludes the id.
 */
export function dedupeHash(input: {
  accountId: string;
  occurredOn: string;
  amountMinor: number;
  description: string;
}): string {
  return createHash('sha256')
    .update(
      [input.accountId, input.occurredOn, String(input.amountMinor), input.description.trim().toLowerCase()].join('|')
    )
    .digest('hex')
    .slice(0, 32);
}

export interface TransactionRow {
  id: string;
  business_id: string;
  account_id: string;
  occurred_on: string;
  amount_minor: number;
  currency: string;
  description: string;
  transaction_kind: TransactionKind;
  category_id: string | null;
  recognized_amount_minor: number;
  gross_amount_minor: number;
  review_status: string;
}

export async function createTransaction(
  ctx: BusinessContext,
  input: CreateTransactionInput,
  options: WriteOptions = {}
): Promise<TransactionRow> {
  const { amountMinor, occurredOn, kind } = validate(ctx, input);

  const account = unwrap(
    await ctx.db
      .from('accounts')
      .select('id, currency, business_id')
      .eq('id', input.accountId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that account'
  ) as { id: string; currency: string; business_id: string };

  if (account.currency !== ctx.business.base_currency) {
    throw new ServiceError(
      'validation',
      `That account is in ${account.currency} but this business's books are in ${ctx.business.base_currency}. Multi-currency is not supported yet.`
    );
  }

  const row = unwrap(
    await ctx.db
      .from('transactions')
      .insert({
        business_id: ctx.businessId,
        account_id: input.accountId,
        occurred_on: occurredOn,
        amount_minor: amountMinor,
        currency: ctx.business.base_currency,
        description: input.description.trim().slice(0, 500),
        merchant: input.merchant?.trim().slice(0, 200) ?? null,
        transaction_kind: kind,
        category_id: input.categoryId ?? null,
        counterparty_id: input.counterpartyId ?? null,
        project_id: input.projectId ?? null,
        brand_id: input.brandId ?? null,
        booking_id: input.bookingId ?? null,
        document_id: input.documentId ?? null,
        gross_amount_minor: input.grossAmountMinor ?? null,
        recognized_amount_minor:
          input.recognizedAmountMinor ?? deriveRecognizedMinor(kind, amountMinor),
        notes: input.notes?.slice(0, 2000) ?? null,
        external_id: input.externalId ?? null,
        import_batch_id: input.importBatchId ?? null,
        raw: (input.raw ?? null) as never,
        dedupe_hash: dedupeHash({
          accountId: input.accountId,
          occurredOn,
          amountMinor,
          description: input.description,
        }),
        source: (options.source ?? 'manual') as never,
        review_status: options.actorType === 'user' || !options.actorType ? 'reviewed' : 'needs_review',
        created_by: ctx.userId,
      })
      .select('id, business_id, account_id, occurred_on, amount_minor, currency, description, transaction_kind, category_id, recognized_amount_minor, gross_amount_minor, review_status')
      .single(),
    'save that transaction'
  ) as unknown as TransactionRow;

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'transaction',
    entityId: row.id,
    action: 'create',
    after: row,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return row;
}

export async function updateTransaction(
  ctx: BusinessContext,
  transactionId: string,
  patch: Partial<Pick<CreateTransactionInput,
    'categoryId' | 'transactionKind' | 'description' | 'merchant' | 'projectId' | 'brandId' |
    'counterpartyId' | 'documentId' | 'notes' | 'recognizedAmountMinor' | 'grossAmountMinor'>> & {
      reviewStatus?: 'unreviewed' | 'needs_review' | 'auto_categorized' | 'reviewed';
    },
  options: WriteOptions = {}
): Promise<TransactionRow> {
  const before = unwrap(
    await ctx.db
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that transaction'
  ) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
  if (patch.transactionKind !== undefined) {
    if (!TRANSACTION_KINDS.includes(patch.transactionKind)) {
      throw new ServiceError('validation', `Unknown transaction type: ${patch.transactionKind}`);
    }
    update.transaction_kind = patch.transactionKind;
    // Reclassifying changes what the transaction means, so recognition
    // must be recomputed rather than left at its old value.
    update.recognized_amount_minor = deriveRecognizedMinor(
      patch.transactionKind,
      before.amount_minor as number
    );
  }
  if (patch.description !== undefined) update.description = patch.description.trim().slice(0, 500);
  if (patch.merchant !== undefined) update.merchant = patch.merchant?.trim().slice(0, 200) ?? null;
  if (patch.projectId !== undefined) update.project_id = patch.projectId;
  if (patch.brandId !== undefined) update.brand_id = patch.brandId;
  if (patch.counterpartyId !== undefined) update.counterparty_id = patch.counterpartyId;
  if (patch.documentId !== undefined) update.document_id = patch.documentId;
  if (patch.notes !== undefined) update.notes = patch.notes?.slice(0, 2000) ?? null;
  if (patch.recognizedAmountMinor !== undefined) update.recognized_amount_minor = patch.recognizedAmountMinor;
  if (patch.grossAmountMinor !== undefined) update.gross_amount_minor = patch.grossAmountMinor;
  if (patch.reviewStatus !== undefined) update.review_status = patch.reviewStatus;

  if (Object.keys(update).length === 0) return before as unknown as TransactionRow;

  const after = unwrap(
    await ctx.db
      .from('transactions')
      .update(update as never)
      .eq('id', transactionId)
      .eq('business_id', ctx.businessId)
      .select('*')
      .single(),
    'update that transaction'
  ) as Record<string, unknown>;

  const diff = diffRecords(before, after);
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'transaction',
    entityId: transactionId,
    action: 'update',
    before: diff.before,
    after: diff.after,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return after as unknown as TransactionRow;
}

/**
 * Soft delete. The row stays for the audit trail and for any report
 * already generated against it; every aggregate filters `deleted_at`.
 */
export async function deleteTransaction(
  ctx: BusinessContext,
  transactionId: string,
  options: WriteOptions = {}
): Promise<void> {
  const before = unwrap(
    await ctx.db.from('transactions').select('*').eq('id', transactionId).eq('business_id', ctx.businessId).single(),
    'find that transaction'
  );

  assertOk(
    await ctx.db
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', transactionId)
      .eq('business_id', ctx.businessId),
    'delete that transaction'
  );

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'transaction',
    entityId: transactionId,
    action: 'delete',
    before,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });
}

// ============================================================
// TRANSFERS
//
// A transfer is always created as a matched PAIR sharing one group id.
// Creating both legs in one call is what makes it structurally
// impossible to record half a transfer and inflate revenue.
// ============================================================

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  occurredOn: string;
  amountMinor?: number;
  amountMajor?: string | number;
  description?: string;
  /** Set when paying down a credit card, so it is labelled correctly. */
  isCreditCardPayment?: boolean;
}

export async function createTransfer(
  ctx: BusinessContext,
  input: CreateTransferInput,
  options: WriteOptions = {}
): Promise<{ transferGroupId: string; outId: string; inId: string }> {
  if (input.fromAccountId === input.toAccountId) {
    throw new ServiceError('validation', 'Choose two different accounts for a transfer.');
  }

  const magnitude = Math.abs(
    typeof input.amountMinor === 'number'
      ? input.amountMinor
      : parseMajorToMinor(input.amountMajor ?? '', ctx.business.base_currency)
  );
  if (magnitude === 0) throw new ServiceError('validation', 'A transfer cannot be for zero.');

  const kind: TransactionKind = input.isCreditCardPayment ? 'credit_card_payment' : 'transfer';
  const transferGroupId = crypto.randomUUID();
  const label = input.description?.trim() || (input.isCreditCardPayment ? 'Credit card payment' : 'Transfer between accounts');

  const rows = unwrap(
    await ctx.db
      .from('transactions')
      .insert([
        {
          business_id: ctx.businessId,
          account_id: input.fromAccountId,
          occurred_on: input.occurredOn,
          amount_minor: -magnitude,
          currency: ctx.business.base_currency,
          description: label,
          transaction_kind: kind,
          recognized_amount_minor: 0,
          transfer_group_id: transferGroupId,
          source: (options.source ?? 'manual') as never,
          review_status: 'reviewed',
          created_by: ctx.userId,
        },
        {
          business_id: ctx.businessId,
          account_id: input.toAccountId,
          occurred_on: input.occurredOn,
          amount_minor: magnitude,
          currency: ctx.business.base_currency,
          description: label,
          transaction_kind: kind,
          recognized_amount_minor: 0,
          transfer_group_id: transferGroupId,
          source: (options.source ?? 'manual') as never,
          review_status: 'reviewed',
          created_by: ctx.userId,
        },
      ])
      .select('id, amount_minor'),
    'record that transfer'
  ) as Array<{ id: string; amount_minor: number }>;

  const outRow = rows.find((r) => r.amount_minor < 0)!;
  const inRow = rows.find((r) => r.amount_minor > 0)!;

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'transfer',
    entityId: transferGroupId,
    action: 'create',
    after: { transferGroupId, magnitude, kind, from: input.fromAccountId, to: input.toAccountId },
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return { transferGroupId, outId: outRow.id, inId: inRow.id };
}

// ── Listing ─────────────────────────────────────────────────

type ReviewStatus = 'unreviewed' | 'needs_review' | 'auto_categorized' | 'reviewed';

export interface ListTransactionsFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  kind?: TransactionKind;
  reviewStatus?: ReviewStatus;
  projectId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TransactionListRow {
  id: string;
  occurred_on: string;
  amount_minor: number;
  currency: string;
  description: string;
  merchant: string | null;
  transaction_kind: TransactionKind;
  category_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  brand_id: string | null;
  document_id: string | null;
  review_status: string;
  transfer_group_id: string | null;
  gross_amount_minor: number;
  recognized_amount_minor: number;
  account_id: string;
  notes: string | null;
}

export async function listTransactions(
  ctx: BusinessContext,
  filters: ListTransactionsFilters = {}
): Promise<{
  transactions: TransactionListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  let query = ctx.db
    .from('transactions')
    .select(
      'id, occurred_on, amount_minor, currency, description, merchant, transaction_kind, category_id, ' +
        'counterparty_id, project_id, brand_id, document_id, review_status, transfer_group_id, gross_amount_minor, ' +
        'recognized_amount_minor, account_id, notes',
      { count: 'exact' }
    )
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null);

  if (filters.from) query = query.gte('occurred_on', filters.from);
  if (filters.to) query = query.lte('occurred_on', filters.to);
  if (filters.accountId) query = query.eq('account_id', filters.accountId);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.kind) query = query.eq('transaction_kind', filters.kind);
  if (filters.reviewStatus) {
    query = query.eq('review_status', filters.reviewStatus as ReviewStatus);
  }
  if (filters.projectId) query = query.eq('project_id', filters.projectId);
  if (filters.search) {
    // Escape PostgREST's or() metacharacters so a search string cannot
    // alter the filter expression.
    const safe = filters.search.replace(/[(),*"\\]/g, ' ').trim().slice(0, 100);
    if (safe) query = query.or(`description.ilike.%${safe}%,merchant.ilike.%${safe}%`);
  }

  const { data, error, count } = await query
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw new ServiceError('internal', 'Could not load transactions.', { detail: error.message, cause: error });

  return {
    transactions: (data ?? []) as unknown as TransactionListRow[],
    total: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

/** Bulk categorisation from the review queue. */
export async function bulkCategorize(
  ctx: BusinessContext,
  transactionIds: string[],
  categoryId: string,
  options: WriteOptions = {}
): Promise<number> {
  if (transactionIds.length === 0) return 0;
  if (transactionIds.length > 500) {
    throw new ServiceError('validation', 'Categorise at most 500 transactions at a time.');
  }

  const { data, error } = await ctx.db
    .from('transactions')
    .update({ category_id: categoryId, review_status: 'reviewed' })
    .in('id', transactionIds)
    .eq('business_id', ctx.businessId)
    .select('id');

  if (error) {
    throw new ServiceError('internal', 'Could not categorise those transactions.', {
      detail: error.message,
      cause: error,
    });
  }

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'transaction',
    action: 'bulk_categorize',
    after: { categoryId, count: data?.length ?? 0, ids: (data ?? []).map((r) => r.id).slice(0, 50) },
    source: options.source ?? 'manual',
  });

  return data?.length ?? 0;
}

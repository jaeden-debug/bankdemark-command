// ============================================================
// CSV IMPORT
//
// Two phases, always: PREVIEW then COMMIT. Nothing touches the ledger
// until the owner has seen exactly what will land.
//
// The importer does the guessing so the owner doesn't have to —
// delimiter, header row, which column is what, and whether debits and
// credits are split. The one thing it refuses to guess is an ambiguous
// date order, because getting that wrong shifts a year of reporting
// silently.
// ============================================================

import 'server-only';
import type { BusinessContext } from './context';
import { ServiceError, unwrap } from './errors';
import { recordAudit } from './audit';
import { parseMajorToMinor } from '@/lib/domain/money';
import {
  detectColumns,
  detectDateOrder,
  parseCsv,
  parseDateLoose,
  type ColumnMapping,
  type DateOrder,
} from '@/lib/domain/csv';
import { dedupeHash } from './transactions';
import type { TransactionKind } from '@/lib/domain/semantics';

export const MAX_IMPORT_ROWS = 5_000;

export interface PreviewRow {
  rowNumber: number;
  occurredOn: string | null;
  amountMinor: number | null;
  description: string;
  /** 'ready' | 'duplicate' | 'error' */
  state: 'ready' | 'duplicate' | 'error';
  problem?: string;
}

export interface ImportPreview {
  mapping: ColumnMapping;
  headers: string[];
  dateOrder: DateOrder;
  /** True when the file's dates are ambiguous and the owner must choose. */
  needsDateOrder: boolean;
  rows: PreviewRow[];
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
  totalInMinor: number;
  totalOutMinor: number;
  truncated: boolean;
}

function cell(row: string[], index: number | null): string {
  if (index === null || index < 0) return '';
  return (row[index] ?? '').trim();
}

/**
 * Turn raw CSV text into a reviewable preview.
 *
 * `dateOrderOverride` is supplied on the second pass once the owner has
 * answered the day-first/month-first question.
 */
export async function previewImport(
  ctx: BusinessContext,
  accountId: string,
  csvText: string,
  options: { dateOrderOverride?: DateOrder; mappingOverride?: Partial<ColumnMapping> } = {}
): Promise<ImportPreview> {
  const currency = ctx.business.base_currency;

  const parsed = parseCsv(csvText);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    throw new ServiceError('validation', "That file doesn't look like a CSV with any rows in it.");
  }

  const mapping: ColumnMapping = { ...detectColumns(parsed), ...options.mappingOverride };

  if (mapping.date === null) {
    throw new ServiceError(
      'validation',
      "We couldn't find a date column. Check the file has one and try again."
    );
  }
  if (mapping.amount === null && !mapping.splitColumns) {
    throw new ServiceError(
      'validation',
      "We couldn't find an amount column. Check the file has one and try again."
    );
  }

  const truncated = parsed.rows.length > MAX_IMPORT_ROWS;
  const rows = parsed.rows.slice(0, MAX_IMPORT_ROWS);

  const dateSample = rows.slice(0, 50).map((r) => cell(r, mapping.date));
  const detectedOrder = detectDateOrder(dateSample);
  const dateOrder = options.dateOrderOverride ?? detectedOrder;
  const needsDateOrder = dateOrder === 'unknown';

  // Existing fingerprints for this account, so duplicates show up in
  // the preview rather than after the damage is done.
  const { data: existing, error: existingError } = await ctx.db
    .from('transactions')
    .select('dedupe_hash')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .not('dedupe_hash', 'is', null)
    .limit(20_000);

  if (existingError) {
    throw new ServiceError('internal', 'Could not check for duplicates.', {
      detail: existingError.message,
      cause: existingError,
    });
  }
  const seen = new Set((existing ?? []).map((r) => r.dedupe_hash as string));

  const preview: PreviewRow[] = [];
  let readyCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  let totalInMinor = 0;
  let totalOutMinor = 0;

  rows.forEach((row, i) => {
    const rowNumber = i + 2; // +1 for zero-index, +1 for the header line
    const description = cell(row, mapping.description) || 'Imported transaction';

    const occurredOn = needsDateOrder ? null : parseDateLoose(cell(row, mapping.date), dateOrder);

    let amountMinor: number | null = null;
    let problem: string | undefined;

    try {
      if (mapping.splitColumns) {
        const debit = cell(row, mapping.debit);
        const credit = cell(row, mapping.credit);
        // Split columns hold magnitudes; the column decides the sign.
        const debitMinor = debit ? Math.abs(parseMajorToMinor(debit, currency)) : 0;
        const creditMinor = credit ? Math.abs(parseMajorToMinor(credit, currency)) : 0;
        if (debitMinor === 0 && creditMinor === 0) {
          problem = 'No amount on this row';
        } else {
          amountMinor = creditMinor - debitMinor;
        }
      } else {
        const raw = cell(row, mapping.amount);
        if (!raw) problem = 'No amount on this row';
        else amountMinor = parseMajorToMinor(raw, currency);
      }
    } catch {
      problem = `Couldn't read the amount`;
    }

    if (!problem && amountMinor === 0) problem = 'Amount is zero';
    if (!problem && !occurredOn) {
      problem = needsDateOrder ? 'Waiting on date format' : `Couldn't read the date`;
    }

    let state: PreviewRow['state'] = 'ready';
    if (problem) {
      state = 'error';
      errorCount += 1;
    } else {
      const hash = dedupeHash({
        accountId,
        occurredOn: occurredOn!,
        amountMinor: amountMinor!,
        description,
      });
      if (seen.has(hash)) {
        state = 'duplicate';
        duplicateCount += 1;
      } else {
        // Guard against the same row appearing twice inside one file.
        seen.add(hash);
        state = 'ready';
        readyCount += 1;
        if (amountMinor! > 0) totalInMinor += amountMinor!;
        else totalOutMinor += -amountMinor!;
      }
    }

    preview.push({ rowNumber, occurredOn, amountMinor, description, state, problem });
  });

  return {
    mapping,
    headers: parsed.headers,
    dateOrder,
    needsDateOrder,
    rows: preview,
    readyCount,
    duplicateCount,
    errorCount,
    totalInMinor,
    totalOutMinor,
    truncated,
  };
}

export interface CommitResult {
  importedCount: number;
  skippedDuplicates: number;
  skippedErrors: number;
  batchId: string;
}

/**
 * Write the rows the owner reviewed.
 *
 * Everything arrives as `needs_review` and uncategorised — an import is
 * data, not a decision. The attention queue then surfaces it, which is
 * exactly where an owner should confirm what things were.
 */
export async function commitImport(
  ctx: BusinessContext,
  accountId: string,
  csvText: string,
  options: { dateOrderOverride?: DateOrder; mappingOverride?: Partial<ColumnMapping>; filename?: string } = {}
): Promise<CommitResult> {
  const preview = await previewImport(ctx, accountId, csvText, options);

  if (preview.needsDateOrder) {
    throw new ServiceError('validation', 'Choose whether dates are day-first or month-first, then import.');
  }
  if (preview.readyCount === 0) {
    throw new ServiceError('validation', 'There is nothing new to import from this file.');
  }

  const account = unwrap(
    await ctx.db
      .from('accounts')
      .select('id, currency')
      .eq('id', accountId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that account'
  ) as { id: string; currency: string };

  if (account.currency !== ctx.business.base_currency) {
    throw new ServiceError(
      'validation',
      `That account is in ${account.currency} but this business's books are in ${ctx.business.base_currency}.`
    );
  }

  const batch = unwrap(
    await ctx.db
      .from('import_batches')
      .insert({
        business_id: ctx.businessId,
        account_id: accountId,
        source: 'csv',
        filename: options.filename?.slice(0, 200) ?? null,
        status: 'previewed',
        mapping: preview.mapping as never,
        row_count: preview.rows.length,
        duplicate_count: preview.duplicateCount,
        error_count: preview.errorCount,
        created_by: ctx.userId,
      })
      .select('id')
      .single(),
    'start that import'
  ) as { id: string };

  const toInsert = preview.rows
    .filter((r) => r.state === 'ready')
    .map((r) => ({
      business_id: ctx.businessId,
      account_id: accountId,
      occurred_on: r.occurredOn!,
      amount_minor: r.amountMinor!,
      currency: ctx.business.base_currency,
      description: r.description.slice(0, 500),
      // Deliberately neutral: an import must not assert what a row means.
      transaction_kind: (r.amountMinor! > 0 ? 'income' : 'expense') as TransactionKind,
      source: 'csv' as const,
      import_batch_id: batch.id,
      review_status: 'needs_review' as const,
      dedupe_hash: dedupeHash({
        accountId,
        occurredOn: r.occurredOn!,
        amountMinor: r.amountMinor!,
        description: r.description,
      }),
      created_by: ctx.userId,
    }));

  // Chunked so a large file doesn't hit statement limits.
  let importedCount = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { data, error } = await ctx.db
      .from('transactions')
      .insert(chunk as never)
      .select('id');

    if (error) {
      await ctx.db
        .from('import_batches')
        .update({ status: 'failed', errors: [{ message: error.message }] as never })
        .eq('id', batch.id);

      throw new ServiceError('internal', 'The import stopped partway through.', {
        detail: `${importedCount} rows were saved before the failure. ${error.message}`,
        cause: error,
      });
    }
    importedCount += data?.length ?? 0;
  }

  await ctx.db
    .from('import_batches')
    .update({
      status: 'committed',
      imported_count: importedCount,
      committed_at: new Date().toISOString(),
    })
    .eq('id', batch.id);

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: 'import',
    entity: 'import_batch',
    entityId: batch.id,
    action: 'commit',
    after: {
      accountId,
      filename: options.filename,
      importedCount,
      duplicateCount: preview.duplicateCount,
      errorCount: preview.errorCount,
    },
    source: 'csv',
  });

  return {
    importedCount,
    skippedDuplicates: preview.duplicateCount,
    skippedErrors: preview.errorCount,
    batchId: batch.id,
  };
}

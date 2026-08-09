// ============================================================
// DOCUMENT SERVICE
//
// Upload, read, and delete receipts and statements.
//
// Two rules shape everything here:
//
//   1. The bucket is private. Files are reached only through
//      short-lived signed URLs minted after a membership check. A
//      leaked storage path is inert on its own.
//   2. The file's BYTES decide what it is. A browser's declared
//      Content-Type is user input and is only ever a cross-check.
// ============================================================

import 'server-only';
import { createHash } from 'node:crypto';
import type { BusinessContext } from './context';
import { ServiceError, logEvent, unwrap } from './errors';
import { recordAudit } from './audit';
import { assertOwned } from './ownership';
import {
  buildStoragePath,
  checkUpload,
  safeDisplayFilename,
  type SafeMime,
} from '@/lib/domain/file-safety';

export const BUCKET = 'documents';

/** Signed URLs live just long enough to render one view. */
const SIGNED_URL_TTL_SECONDS = 300;

export type DocType = 'receipt' | 'invoice' | 'statement' | 'contract' | 'commission_report' | 'other';

export interface DocumentRow {
  id: string;
  business_id: string;
  storage_path: string;
  doc_type: DocType;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  vendor: string | null;
  doc_date: string | null;
  amount_minor: number | null;
  currency: string | null;
  extracted: unknown;
  status: string;
  extraction_method: string | null;
  extraction_model: string | null;
  extraction_confidence: number | null;
  extracted_at: string | null;
  extraction_error: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  matched_transaction_id: string | null;
  created_at: string;
}

export interface UploadResult {
  document: DocumentRow;
  /** True when this exact file was already stored; nothing new was written. */
  duplicate: boolean;
}

/**
 * Store an uploaded file.
 *
 * Validation order matters: size, then bytes, then hash. Hashing a
 * 200 MB file we were going to reject anyway is wasted work, and
 * sniffing a file we have not size-checked is a memory risk.
 */
export async function uploadDocument(
  ctx: BusinessContext,
  input: {
    bytes: Uint8Array;
    sizeBytes: number;
    declaredMime?: string | null;
    filename?: string | null;
    docType?: DocType;
  }
): Promise<UploadResult> {
  const check = checkUpload({
    bytes: input.bytes,
    sizeBytes: input.sizeBytes,
    declaredMime: input.declaredMime,
    filename: input.filename,
  });

  if (!check.ok || !check.mime || !check.extension) {
    throw new ServiceError('validation', check.reason ?? 'That file cannot be used.');
  }

  // A mismatch between what the browser claimed and what the bytes say
  // is worth knowing about, even when we accept the file.
  if (input.declaredMime && input.declaredMime !== check.mime) {
    logEvent('document.mime_mismatch', {
      businessId: ctx.businessId,
      declared: input.declaredMime,
      actual: check.mime,
    });
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  // The same receipt photographed twice is one document.
  const { data: existing } = await ctx.db
    .from('documents')
    .select('*')
    .eq('business_id', ctx.businessId)
    .eq('sha256', sha256)
    .maybeSingle();

  if (existing) {
    return { document: existing as unknown as DocumentRow, duplicate: true };
  }

  // Reserve the row first so the storage path can carry its id, which
  // keeps the object name free of anything the user supplied.
  const documentId = crypto.randomUUID();
  const storagePath = buildStoragePath(ctx.businessId, documentId, check.extension);

  const { error: uploadError } = await ctx.db.storage
    .from(BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: check.mime,
      upsert: false,
    });

  if (uploadError) {
    throw new ServiceError('internal', 'That file could not be saved.', {
      detail: uploadError.message,
      cause: uploadError,
    });
  }

  const { data: row, error: insertError } = await ctx.db
    .from('documents')
    .insert({
      id: documentId,
      business_id: ctx.businessId,
      storage_path: storagePath,
      doc_type: input.docType ?? 'receipt',
      original_filename: safeDisplayFilename(input.filename),
      mime_type: check.mime,
      size_bytes: input.sizeBytes,
      sha256,
      status: 'uploaded',
      uploaded_by: ctx.userId,
    })
    .select('*')
    .single();

  if (insertError || !row) {
    // Do not leave an orphaned object behind if the row fails.
    await ctx.db.storage.from(BUCKET).remove([storagePath]);
    throw new ServiceError('internal', 'That file could not be saved.', {
      detail: insertError?.message,
      cause: insertError,
    });
  }

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    entity: 'document',
    entityId: documentId,
    action: 'upload',
    after: { docType: input.docType ?? 'receipt', mime: check.mime, sizeBytes: input.sizeBytes },
    source: 'manual',
  });

  return { document: row as unknown as DocumentRow, duplicate: false };
}

/**
 * A short-lived URL for viewing one document.
 *
 * Ownership is re-established here rather than trusted from the caller.
 * Storage RLS would also block it, but failing in the service gives a
 * clean error instead of an opaque storage rejection.
 */
export async function getSignedUrl(ctx: BusinessContext, documentId: string): Promise<string> {
  await assertOwned(ctx, 'documents', documentId);

  const doc = unwrap(
    await ctx.db
      .from('documents')
      .select('storage_path')
      .eq('id', documentId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that document'
  ) as { storage_path: string };

  // Defence in depth. The row is owned by this business, but the path
  // it stores is just a string — a bug or a bad write elsewhere could
  // leave it pointing into another business's folder. Storage RLS should
  // catch that on read; this refuses to even ask, so correctness does
  // not depend on the exact RLS semantics of createSignedUrl.
  const expectedPrefix = `${ctx.businessId}/`;
  if (!doc.storage_path.startsWith(expectedPrefix)) {
    throw new ServiceError('forbidden', 'That document could not be opened.', {
      detail: `path ${doc.storage_path} outside business ${ctx.businessId}`,
    });
  }

  const { data, error } = await ctx.db.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new ServiceError('internal', 'Could not open that document.', { detail: error?.message });
  }
  return data.signedUrl;
}

/** Raw bytes, for server-side extraction. Never exposed to a client. */
export async function downloadDocument(
  ctx: BusinessContext,
  documentId: string
): Promise<{ bytes: Uint8Array; mime: SafeMime; document: DocumentRow }> {
  const doc = unwrap(
    await ctx.db
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that document'
  ) as unknown as DocumentRow;

  if (!doc.storage_path.startsWith(`${ctx.businessId}/`)) {
    throw new ServiceError('forbidden', 'That document could not be read.', {
      detail: `path ${doc.storage_path} outside business ${ctx.businessId}`,
    });
  }

  const { data, error } = await ctx.db.storage.from(BUCKET).download(doc.storage_path);
  if (error || !data) {
    throw new ServiceError('internal', 'Could not read that document.', { detail: error?.message });
  }

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mime: doc.mime_type as SafeMime,
    document: doc,
  };
}

export async function listDocuments(
  ctx: BusinessContext,
  options: { status?: string; docType?: DocType; limit?: number } = {}
): Promise<DocumentRow[]> {
  let query = ctx.db
    .from('documents')
    .select('*')
    .eq('business_id', ctx.businessId)
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? 100, 200));

  if (options.status) query = query.eq('status', options.status);
  if (options.docType) query = query.eq('doc_type', options.docType);

  const { data, error } = await query;
  if (error) {
    throw new ServiceError('internal', 'Could not load documents.', { detail: error.message });
  }
  return (data ?? []) as unknown as DocumentRow[];
}

/**
 * Remove a document and its stored file.
 *
 * The row goes first. An orphaned object costs storage; an orphaned row
 * pointing at a deleted file breaks every screen that renders it.
 */
export async function deleteDocument(ctx: BusinessContext, documentId: string): Promise<void> {
  const doc = unwrap(
    await ctx.db
      .from('documents')
      .select('id, storage_path, matched_transaction_id')
      .eq('id', documentId)
      .eq('business_id', ctx.businessId)
      .single(),
    'find that document'
  ) as { id: string; storage_path: string; matched_transaction_id: string | null };

  if (doc.matched_transaction_id) {
    throw new ServiceError(
      'validation',
      'That document is attached to a transaction. Detach it there first.'
    );
  }

  const { error } = await ctx.db
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('business_id', ctx.businessId);

  if (error) {
    throw new ServiceError('internal', 'Could not delete that document.', { detail: error.message });
  }

  await ctx.db.storage.from(BUCKET).remove([doc.storage_path]);

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    entity: 'document',
    entityId: documentId,
    action: 'delete',
    before: { storagePath: doc.storage_path },
    source: 'manual',
  });
}

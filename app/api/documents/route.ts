// ============================================================
// DOCUMENT UPLOAD
//
// One request does the whole first pass: store the file, read it, and
// check whether it is already in the books. Anything else would make a
// receipt a three-step chore, and the point is that it is one.
//
// Nothing is written to the ledger here. The response is a PROPOSAL the
// user confirms — extraction is a guess about someone else's document,
// and a guess must never become a financial record on its own.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { isEnabled, checkQuota, planFor } from '@/lib/services/entitlements';
import { uploadDocument, listDocuments, deleteDocument, type DocType } from '@/lib/services/documents';
import { extractReceipt, extractCommissionReport, checkArithmetic } from '@/lib/zylx/extraction';
import { persistCommissionReportExtraction } from '@/lib/services/commission-reports';
import { findMatches } from '@/lib/domain/matching';
import { loadTransactions, resolvePeriod } from '@/lib/services/finance';
import { VISION_CAPABLE, MAX_FILE_BYTES, type SafeMime } from '@/lib/domain/file-safety';
import { formatMinor } from '@/lib/domain/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOC_TYPES: DocType[] = ['receipt', 'invoice', 'statement', 'contract', 'commission_report', 'other'];

export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(businessId, 'viewer');
    const documents = await listDocuments(ctx, {
      status: req.nextUrl.searchParams.get('status') ?? undefined,
      limit: Number(req.nextUrl.searchParams.get('limit')) || 100,
    });

    // `extracted` can contain raw document text. It is not needed for a
    // list view, so it is not sent to one.
    return NextResponse.json({
      documents: documents.map(({ extracted, ...rest }) => rest),
    });
  } catch (error) {
    const e = toServiceError(error, 'load documents');
    logError('documents.list_failed', e, { route: '/api/documents' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const form = await req.formData();
    const businessId = String(form.get('businessId') ?? '');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(businessId, 'member');

    // ── Entitlement ───────────────────────────────────────
    const { data: profile } = await ctx.db
      .from('profiles').select('plan').eq('id', ctx.userId).single();
    const plan = profile?.plan ?? 'free';

    if (!isEnabled(plan, 'receipts')) {
      throw new ServiceError('forbidden', 'Receipt storage is not included in your plan.');
    }

    const { count: used } = await ctx.db
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', ctx.businessId);

    const quota = checkQuota(plan, 'receipts', used ?? 0);
    if (!quota.allowed) {
      throw new ServiceError(
        'forbidden',
        `${quota.reason} Your ${planFor(plan).name} plan includes ${quota.limit}.`
      );
    }

    // ── File ──────────────────────────────────────────────
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ServiceError('validation', 'No file was attached.');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ServiceError(
        'validation',
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const docTypeRaw = String(form.get('docType') ?? 'receipt') as DocType;
    const docType = DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : 'receipt';

    const { document, duplicate } = await uploadDocument(ctx, {
      bytes,
      sizeBytes: file.size,
      declaredMime: file.type,
      filename: file.name,
      docType,
    });

    if (duplicate) {
      logEvent('document.duplicate_upload', { requestId, businessId: ctx.businessId });
      return NextResponse.json({
        ok: true,
        duplicate: true,
        document: { ...document, extracted: undefined },
        message: 'You have already uploaded this exact file.',
      });
    }

    // ── Extraction ────────────────────────────────────────
    const mime = document.mime_type as SafeMime;
    if (!VISION_CAPABLE.has(mime)) {
      // Stored, but honestly reported as unread rather than silently empty.
      await ctx.db
        .from('documents')
        .update({ status: 'uploaded', extraction_method: 'none' })
        .eq('id', document.id);

      return NextResponse.json({
        ok: true,
        document: { ...document, extracted: undefined },
        extraction: null,
        message:
          mime === 'application/pdf'
            ? 'Saved. Reading PDFs is not available yet, so enter the details yourself.'
            : 'Saved. This format cannot be read automatically yet.',
      });
    }

    if (docType === 'commission_report') {
      try {
        const extraction = await extractCommissionReport({
          bytes, mime, currencyHint: ctx.business.base_currency,
          todayIso: new Date().toISOString().slice(0, 10),
        });
        const reconciliation = await persistCommissionReportExtraction(ctx, document.id, extraction);
        return NextResponse.json({
          ok: true,
          document: { ...document, extracted: undefined },
          report: {
            rowCount: reconciliation.rows.length,
            matchedCount: reconciliation.rows.filter((r) => r.status === 'matched').length,
            attentionCount: reconciliation.rows.filter((r) => r.status === 'needs_attention').length + (reconciliation.reportAnomaly ? 1 : 0),
          },
        });
      } catch (error) {
        const e = toServiceError(error, 'read that commission report');
        await ctx.db.from('documents').update({
          status: 'failed', extraction_error: e.message, extraction_method: 'ai_vision',
        }).eq('id', document.id);
        return NextResponse.json({
          ok: true, document: { ...document, extracted: undefined }, extraction: null,
          message: 'Saved as evidence, but no report rows could be read. Try a clearer image.',
        });
      }
    }

    const { data: categories } = await ctx.db
      .from('categories')
      .select('slug')
      .or(`business_id.eq.${ctx.businessId},business_id.is.null`)
      .eq('kind', 'expense')
      .eq('is_active', true);

    const slugs = (categories ?? []).map((c) => c.slug);

    let extraction;
    try {
      extraction = await extractReceipt({
        bytes,
        mime,
        currencyHint: ctx.business.base_currency,
        categorySlugs: slugs,
        todayIso: new Date().toISOString().slice(0, 10),
      });
    } catch (error) {
      const e = toServiceError(error, 'read that document');
      await ctx.db
        .from('documents')
        .update({ status: 'failed', extraction_error: e.message, extraction_method: 'ai_vision' })
        .eq('id', document.id);

      logError('document.extraction_failed', e, { requestId, businessId: ctx.businessId });

      // The file is safely stored, so this is a partial success.
      return NextResponse.json({
        ok: true,
        document: { ...document, extracted: undefined },
        extraction: null,
        message: 'Saved, but the text could not be read. Enter the details yourself.',
      });
    }

    if (extraction.suspectedInjection) {
      logEvent('document.suspected_injection', {
        requestId,
        businessId: ctx.businessId,
        documentId: document.id,
      });
    }

    await ctx.db
      .from('documents')
      .update({
        status: 'extracted',
        vendor: extraction.vendor,
        doc_date: extraction.date,
        amount_minor: extraction.totalMinor,
        currency: extraction.currency,
        extracted: extraction as never,
        extraction_method: 'ai_vision',
        extraction_model: process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'gpt-4o',
        extraction_confidence: extraction.confidence,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', document.id);

    // ── Duplicate check ───────────────────────────────────
    //
    // Scoped to a window around the receipt date rather than the whole
    // ledger: a match six months away is noise, and loading everything
    // to find it would not scale.
    const anchor = extraction.date ?? new Date().toISOString().slice(0, 10);
    const window = {
      from: shiftDays(anchor, -21),
      to: shiftDays(anchor, 21),
      label: 'around the receipt date',
    };

    const nearby = await loadTransactions(ctx.db, ctx.businessId, window, { limit: 2000 });
    const matches = findMatches(
      { amountMinor: extraction.totalMinor, date: extraction.date, vendor: extraction.vendor },
      nearby
    );

    const currency = ctx.business.base_currency;
    const txById = new Map(nearby.map((t) => [t.id, t]));

    logEvent('document.extracted', {
      requestId,
      businessId: ctx.businessId,
      documentId: document.id,
      confidence: extraction.confidence,
      matchCount: matches.candidates.length,
    });

    return NextResponse.json({
      ok: true,
      document: { ...document, extracted: undefined },
      extraction: {
        vendor: extraction.vendor,
        date: extraction.date,
        currency: extraction.currency,
        totalFormatted: extraction.totalMinor !== null ? formatMinor(extraction.totalMinor, currency, { showMinor: true }) : null,
        totalMinor: extraction.totalMinor,
        taxFormatted: extraction.taxMinor !== null ? formatMinor(extraction.taxMinor, currency, { showMinor: true }) : null,
        suggestedCategorySlug: extraction.suggestedCategorySlug,
        confidence: extraction.confidence,
        uncertainties: extraction.uncertainties,
        arithmeticWarning: checkArithmetic(extraction),
        suspectedInjection: extraction.suspectedInjection,
        // Raw document text is deliberately NOT returned. It is untrusted
        // and has no use in the UI; it stays server-side for Zylx, fenced.
      },
      matches: {
        likelyDuplicate: matches.likelyDuplicate
          ? describeMatch(matches.likelyDuplicate, txById, currency)
          : null,
        candidates: matches.candidates.map((c) => describeMatch(c, txById, currency)),
      },
    });
  } catch (error) {
    const e = toServiceError(error, 'save that document');
    logError('documents.upload_failed', e, { requestId, route: '/api/documents' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    const documentId = req.nextUrl.searchParams.get('documentId');
    if (!businessId || !documentId) throw new ServiceError('validation', 'Missing document.');

    const ctx = await requireBusiness(businessId, 'member');
    await deleteDocument(ctx, documentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const e = toServiceError(error, 'delete that document');
    logError('documents.delete_failed', e, { route: '/api/documents' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

function describeMatch(
  candidate: { transactionId: string; score: number; reasons: string[]; confident: boolean },
  txById: Map<string, { occurred_on: string; amount_minor: number; description?: string | null; merchant?: string | null }>,
  currency: string
) {
  const tx = txById.get(candidate.transactionId);
  return {
    transactionId: candidate.transactionId,
    date: tx?.occurred_on ?? null,
    description: tx?.description ?? tx?.merchant ?? null,
    amount: tx ? formatMinor(tx.amount_minor, currency, { showMinor: true }) : null,
    score: Number(candidate.score.toFixed(2)),
    reasons: candidate.reasons,
    confident: candidate.confident,
  };
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

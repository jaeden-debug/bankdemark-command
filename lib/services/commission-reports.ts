import 'server-only';
import type { BusinessContext } from './context';
import { ServiceError, unwrap } from './errors';
import { recordAudit } from './audit';
import type { ExtractedCommissionReport } from '@/lib/zylx/extraction';
import {
  normalizeBookingReference,
  reconcileCommissionRows,
  type ReconciliationBooking,
} from '@/lib/domain/commission-reconciliation';

export async function persistCommissionReportExtraction(
  ctx: BusinessContext,
  documentId: string,
  extraction: ExtractedCommissionReport
) {
  const document = unwrap(
    await ctx.db.from('documents').select('id, business_id, doc_type')
      .eq('id', documentId).eq('business_id', ctx.businessId).single(),
    'find that commission report'
  ) as { id: string; business_id: string; doc_type: string };
  if (document.doc_type !== 'commission_report') {
    throw new ServiceError('validation', 'That document is not a commission report.');
  }
  if (extraction.rows.length === 0) {
    throw new ServiceError('validation', 'No commission rows could be read from that image.');
  }

  const { data: bookings, error } = await ctx.db.from('bookings')
    .select('id, reference, commission_expected_minor, commission_received_minor, currency')
    .eq('business_id', ctx.businessId);
  if (error) throw new ServiceError('internal', 'Could not load bookings for reconciliation.', { detail: error.message });

  const truth: ReconciliationBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    reference: b.reference,
    expectedMinor: b.commission_expected_minor,
    receivedMinor: b.commission_received_minor,
    currency: b.currency,
  }));
  const reconciliation = reconcileCommissionRows({
    bookings: truth,
    rows: extraction.rows.map((row) => ({
      bookingReference: row.bookingReference,
      amountMinor: row.commissionAmountMinor,
      currency: extraction.currency,
      confidence: row.confidence,
    })),
    printedTotalMinor: extraction.printedTotalMinor,
  });

  const lineRows = reconciliation.rows.map((row) => ({
    business_id: ctx.businessId,
    document_id: documentId,
    row_position: row.rowPosition,
    raw_booking_reference: row.bookingReference,
    normalized_booking_reference: row.normalizedReference,
    reported_amount_minor: row.amountMinor,
    currency: row.currency,
    matched_booking_id: row.matchedBookingId,
    match_status: row.status,
    anomaly_code: row.anomalyCode,
    anomaly_detail: row.anomalyDetail,
    extraction_confidence: row.confidence ?? extraction.confidence,
  }));
  if (reconciliation.reportAnomaly) {
    lineRows.push({
      business_id: ctx.businessId,
      document_id: documentId,
      row_position: 0,
      raw_booking_reference: null as unknown as string,
      normalized_booking_reference: null as unknown as string,
      reported_amount_minor: extraction.printedTotalMinor!,
      currency: extraction.currency,
      matched_booking_id: null,
      match_status: 'needs_attention',
      anomaly_code: reconciliation.reportAnomaly.code,
      anomaly_detail: reconciliation.reportAnomaly.detail,
      extraction_confidence: extraction.confidence,
    });
  }

  const { error: linesError } = await ctx.db.from('commission_report_lines').insert(lineRows);
  if (linesError) throw new ServiceError('internal', 'Could not save extracted report rows.', { detail: linesError.message });

  const { error: updateError } = await ctx.db.from('documents').update({
    status: 'extracted',
    vendor: extraction.agencyOrSupplier,
    doc_date: extraction.reportDate,
    amount_minor: extraction.printedTotalMinor,
    currency: extraction.currency,
    extracted: extraction as never,
    extraction_method: 'ai_vision',
    extraction_model: process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'gpt-4o',
    extraction_confidence: extraction.confidence,
    extracted_at: new Date().toISOString(),
  }).eq('id', documentId).eq('business_id', ctx.businessId);
  if (updateError) throw new ServiceError('internal', 'Could not finish that report.', { detail: updateError.message });

  await recordAudit(ctx.db, {
    businessId: ctx.businessId, actorUserId: ctx.userId, entity: 'commission_report',
    entityId: documentId, action: 'extract_and_reconcile',
    after: { rowCount: reconciliation.rows.length, matchedCount: reconciliation.rows.filter((r) => r.status === 'matched').length },
    source: 'zylx',
  });
  return reconciliation;
}

export async function getCommissionReport(ctx: BusinessContext, documentId: string) {
  const document = unwrap(
    await ctx.db.from('documents')
      .select('id, vendor, doc_date, amount_minor, currency, status, original_filename, extraction_confidence, confirmed_at')
      .eq('id', documentId).eq('business_id', ctx.businessId).eq('doc_type', 'commission_report').single(),
    'find that commission report'
  ) as { id: string; vendor: string | null; doc_date: string | null; amount_minor: number | null; currency: string | null; status: string; original_filename: string | null; extraction_confidence: number | null; confirmed_at: string | null };
  const { data: lines, error } = await ctx.db.from('commission_report_lines').select('*')
    .eq('business_id', ctx.businessId).eq('document_id', documentId).order('row_position');
  if (error) throw new ServiceError('internal', 'Could not load report rows.', { detail: error.message });

  const refs = new Set((lines ?? []).filter((l) => l.row_position > 0).map((l) => l.normalized_booking_reference));
  const { data: bookings } = await ctx.db.from('bookings')
    .select('id, reference, commission_expected_minor, commission_received_minor, currency, service_date')
    .eq('business_id', ctx.businessId);
  const bookingById = new Map((bookings ?? []).map((b) => [b.id, b]));
  const notOnReport = (bookings ?? []).filter((b) =>
    b.reference && !refs.has(normalizeBookingReference(b.reference)) &&
    b.commission_expected_minor > b.commission_received_minor
  );

  return {
    document,
    lines: (lines ?? []).map((line) => ({ ...line, booking: line.matched_booking_id ? bookingById.get(line.matched_booking_id) ?? null : null })),
    notOnReport,
  };
}

export async function approveCommissionReport(ctx: BusinessContext, documentId: string) {
  const { data, error } = await ctx.db.rpc('bdm_approve_commission_report', { p_document_id: documentId });
  if (error) throw new ServiceError('conflict', 'The report changed. Review it again before approving.', { detail: error.message });
  return data as { paymentCount: number; idempotent: boolean };
}

export async function getTravelCommissionPipeline(ctx: BusinessContext) {
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: bookings, error }, { data: evidencePayments }, { data: anomalies }] = await Promise.all([
    ctx.db.from('bookings').select(
      'id, reference, service_date, return_date, supplier_id, commission_expected_minor, commission_received_minor, commission_status, currency'
    ).eq('business_id', ctx.businessId).neq('status', 'cancelled'),
    ctx.db.from('commission_payments').select('amount_minor, received_on, booking_id, currency')
      .eq('business_id', ctx.businessId).not('report_line_id', 'is', null),
    ctx.db.from('commission_report_lines').select('id, matched_booking_id')
      .eq('business_id', ctx.businessId).eq('match_status', 'needs_attention'),
  ]);
  if (error) throw new ServiceError('internal', 'Could not load the commission pipeline.', { detail: error.message });
  const evidenceByBooking = new Map<string, number>();
  for (const payment of evidencePayments ?? []) {
    evidenceByBooking.set(payment.booking_id, (evidenceByBooking.get(payment.booking_id) ?? 0) + payment.amount_minor);
  }
  // Travel UI treats only report-backed payments as paid evidence.
  const rows = (bookings ?? []).map((booking) => ({
    ...booking,
    commission_received_minor: evidenceByBooking.get(booking.id) ?? 0,
  }));
  const baseRows = rows.filter((b) => b.currency === ctx.business.base_currency);
  const pendingMinor = baseRows.reduce((sum, b) => sum + Math.max(0, b.commission_expected_minor - b.commission_received_minor), 0);
  const paidMinor = (evidencePayments ?? []).filter((p) => p.currency === ctx.business.base_currency).reduce((sum, p) => sum + p.amount_minor, 0);
  const completedPending = rows.filter((b) =>
    Math.max(0, b.commission_expected_minor - b.commission_received_minor) > 0 &&
    ((b.return_date && b.return_date < today) || (!b.return_date && b.service_date && b.service_date < today))
  );
  const upcomingPending = rows.filter((b) =>
    b.service_date && b.service_date >= today && b.commission_expected_minor > b.commission_received_minor
  );
  const monthMap = new Map<string, { month: string; paidMinor: number; pendingMinor: number }>();
  for (const booking of baseRows) {
    if (!booking.service_date) continue;
    const month = booking.service_date.slice(0, 7);
    const item = monthMap.get(month) ?? { month, paidMinor: 0, pendingMinor: 0 };
    item.paidMinor += booking.commission_received_minor;
    item.pendingMinor += Math.max(0, booking.commission_expected_minor - booking.commission_received_minor);
    monthMap.set(month, item);
  }
  return {
    bookings: rows,
    pendingMinor,
    paidMinor,
    upcomingPending,
    completedPending,
    needsAttentionCount: anomalies?.length ?? 0,
    attentionBookingIds: [...new Set((anomalies ?? []).flatMap((a) => a.matched_booking_id ? [a.matched_booking_id] : []))],
    averageExpectedMinor: baseRows.length ? Math.round(baseRows.reduce((s, b) => s + b.commission_expected_minor, 0) / baseRows.length) : 0,
    excludedCurrencyCount: rows.length - baseRows.length,
    byDepartureMonth: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export async function getCommissionAnomalies(ctx: BusinessContext, limit = 100) {
  const { data, error } = await ctx.db.from('commission_report_lines').select('*')
    .eq('business_id', ctx.businessId).eq('match_status', 'needs_attention')
    .order('created_at', { ascending: false }).limit(Math.min(limit, 200));
  if (error) throw new ServiceError('internal', 'Could not load commission anomalies.', { detail: error.message });
  return data ?? [];
}

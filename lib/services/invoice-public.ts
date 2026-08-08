// ============================================================
// PUBLIC INVOICE ACCESS
//
// The ONLY path by which an unauthenticated visitor can see an
// invoice. It runs with the service role behind a constant-time token
// comparison, and returns exactly one invoice or nothing.
//
// No RLS policy anywhere grants `anon` access, so this module is the
// entire public attack surface — deliberately small, and it never
// takes a business id, invoice id or any other caller-chosen selector.
// ============================================================

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { adminDb } from './context';
import { logError, logEvent } from './errors';
import type {
  InvoiceRow,
  InvoiceLineRow,
  BusinessSnapshot,
  ClientSnapshot,
} from './invoices';

export interface ResolvedShare {
  businessId: string;
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  business: BusinessSnapshot;
  client: ClientSnapshot;
  logoDataUri: string | null;
}

/** Tokens are 32 random bytes, base64url. Anything else is not one. */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,120}$/;

/** Length-safe, constant-time string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function resolveShareToken(token: string): Promise<ResolvedShare | null> {
  if (!token || !TOKEN_RE.test(token)) return null;

  const db = adminDb();

  const { data, error } = await db
    .from('invoices')
    .select(
      'id, business_id, counterparty_id, source_kind, booking_id, project_id, document_id, ' +
      'parent_invoice_id, is_credit_note, number, currency, issue_date, due_date, status, ' +
      'subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, balance_minor, ' +
      'discount_kind, discount_value, tax_breakdown, notes, terms, payment_terms, ' +
      'payment_instructions, custom_fields, issued_business_snapshot, issued_client_snapshot, ' +
      'share_token, share_revoked_at, issued_at, sent_at, viewed_at, paid_at, voided_at, ' +
      'void_reason, created_at, updated_at'
    )
    .eq('share_token', token)
    .maybeSingle();

  if (error) {
    logError('invoice.share_lookup_failed', error, {});
    return null;
  }
  if (!data) return null;

  const invoice = data as unknown as InvoiceRow;

  // Re-compare in constant time. The equality above already selected
  // the row, but this keeps the comparison itself non-leaky and guards
  // against any future change to how the lookup is performed.
  if (!constantTimeEqual(invoice.share_token ?? '', token)) return null;

  // A revoked link, an unissued draft, or a voided invoice is simply
  // not found — the visitor learns nothing either way.
  if (invoice.share_revoked_at) return null;
  if (!invoice.issued_at) return null;
  if (invoice.status === 'void') return null;

  // An issued invoice always has both snapshots (enforced by a CHECK
  // constraint), so the public page never reads live identity.
  if (!invoice.issued_business_snapshot || !invoice.issued_client_snapshot) {
    logError('invoice.share_missing_snapshot', new Error('issued invoice without snapshot'), {
      businessId: invoice.business_id,
    });
    return null;
  }

  const { data: lineData, error: lineError } = await db
    .from('invoice_lines')
    .select(
      'id, invoice_id, position, description, quantity, unit_price_minor, subtotal_minor, ' +
      'discount_minor, tax_code, tax_label, tax_rate, tax_treatment, tax_minor, total_minor, ' +
      'category_id, project_id'
    )
    .eq('invoice_id', invoice.id)
    .order('position');

  if (lineError) {
    logError('invoice.share_lines_failed', lineError, { businessId: invoice.business_id });
    return null;
  }

  const { loadLogoDataUri } = await import('./invoice-render');

  return {
    businessId: invoice.business_id,
    invoice,
    lines: (lineData ?? []) as unknown as InvoiceLineRow[],
    business: invoice.issued_business_snapshot,
    client: invoice.issued_client_snapshot,
    // Inlined: the bucket is private, so the client's browser could
    // never fetch it, and the PDF renderer has no network.
    logoDataUri: await loadLogoDataUri(invoice.issued_business_snapshot.logo_path, db),
  };
}

/**
 * Record that the client opened the invoice, and advance `sent` to
 * `viewed`. Never moves a paid or overdue invoice backwards.
 */
export async function recordShareView(businessId: string, invoiceId: string): Promise<void> {
  const db = adminDb();
  try {
    await db.from('invoice_events').insert({
      invoice_id: invoiceId,
      business_id: businessId,
      actor_user_id: null,
      actor_type: 'system',
      event: 'viewed',
      detail: {} as never,
    });

    await db
      .from('invoices')
      .update({ status: 'viewed', viewed_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('status', 'sent');

    logEvent('invoice.viewed_by_client', { businessId, invoiceId });
  } catch (error) {
    // Tracking must never break the client's ability to see the invoice.
    logError('invoice.share_view_failed', error, { businessId, invoiceId });
  }
}

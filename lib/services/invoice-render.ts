// ============================================================
// RENDERABLE INVOICE
//
// Turns a stored invoice into exactly the inputs the document
// renderer needs — from the frozen snapshot when the invoice has been
// issued, and from live settings only while it is still a draft
// (a preview of what issuing would capture).
// ============================================================

import 'server-only';
import type { RenderableInvoice } from './invoice-document';
import type { InvoiceDetail, BusinessSnapshot, ClientSnapshot } from './invoices';
import type { Db } from './context';
import { adminDb } from './context';
import { logError } from './errors';

/**
 * Fetch the logo and inline it as a data URI.
 *
 * The PDF renderer blocks all network requests, and the bucket is
 * private, so a URL would never load. Embedding the bytes is the only
 * way the logo reaches the document — and it keeps the PDF
 * self-contained forever.
 */
export async function loadLogoDataUri(
  logoPath: string | null | undefined,
  db?: Db
): Promise<string | null> {
  if (!logoPath) return null;
  try {
    const client = db ?? adminDb();
    const { data, error } = await client.storage.from('business-logos').download(logoPath);
    if (error || !data) return null;

    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.byteLength > 2 * 1024 * 1024) return null;

    const ext = logoPath.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'svg' ? 'image/svg+xml'
      : null;
    if (!mime) return null;

    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (error) {
    // A missing logo must never stop an invoice rendering.
    logError('invoice.logo_load_failed', error, {});
    return null;
  }
}

/**
 * `fallback` supplies identity for DRAFT previews only. An issued
 * invoice ignores it entirely and uses its own snapshot, which is what
 * makes historical documents stable.
 */
export function buildRenderable(
  detail: InvoiceDetail,
  fallback?: { businessName: string; template?: string; accentColor?: string }
): RenderableInvoice {
  const snapshot: BusinessSnapshot = detail.invoice.issued_business_snapshot ?? {
    name: fallback?.businessName ?? 'Your business',
    legal_name: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
    email: null,
    phone: null,
    website: null,
    tax_number: null,
    tax_number_label: 'Tax no.',
    logo_path: null,
    template: fallback?.template ?? 'clean',
    accent_color: fallback?.accentColor ?? '#c6a24a',
    footer_text: null,
    show_bdm_credit: true,
  };

  const client: ClientSnapshot = detail.invoice.issued_client_snapshot ?? {
    name: detail.counterparty?.name ?? 'No client selected',
    email: detail.counterparty?.email ?? null,
    phone: detail.counterparty?.phone ?? null,
    kind: null,
  };

  return {
    invoice: detail.invoice,
    lines: detail.lines,
    business: snapshot,
    client,
  };
}

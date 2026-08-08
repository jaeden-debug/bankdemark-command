// ============================================================
// INVOICE PDF
//
// Rendered from the issued snapshot, so the document is identical
// every time it is produced. When no PDF engine is available the
// response is the same document as print-ready HTML with the print
// dialog opened — never a broken or half-rendered file.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { getInvoice } from '@/lib/services/invoices';
import { renderInvoiceHtml, renderInvoicePdf } from '@/lib/services/invoice-document';
import { buildRenderable, loadLogoDataUri } from '@/lib/services/invoice-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Chromium cold start on serverless needs headroom.
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    // Reading your own invoice is never plan-gated.
    const ctx = await requireBusiness(businessId, 'viewer');
    const detail = await getInvoice(ctx, params.invoiceId);

    if (!detail.invoice.issued_at) {
      throw new ServiceError(
        'conflict',
        'This invoice has not been issued yet, so there is no final document to download.'
      );
    }

    const renderable = buildRenderable(detail);
    renderable.logoDataUri = await loadLogoDataUri(
      renderable.business.logo_path,
      ctx.db
    );
    const html = renderInvoiceHtml(renderable);
    const filename = `${(detail.invoice.number ?? 'invoice').replace(/[^\w-]/g, '')}.pdf`;

    const pdf = await renderInvoicePdf(html);

    if (pdf.ok && pdf.pdf) {
      logEvent('invoice.pdf_rendered', { businessId, invoiceId: params.invoiceId });
      return new NextResponse(new Uint8Array(pdf.pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    // Honest fallback: the same document, print-ready.
    logEvent('invoice.pdf_fallback_html', {
      businessId,
      invoiceId: params.invoiceId,
      reason: pdf.reason,
    });
    return new NextResponse(
      html.replace(
        '</body>',
        `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script></body>`
      ),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-BDM-Pdf-Fallback': pdf.reason ?? 'unavailable',
        },
      }
    );
  } catch (error) {
    const e = toServiceError(error, 'produce that PDF');
    logError('invoice.pdf_failed', e, { route: '/api/invoices/[invoiceId]/pdf' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

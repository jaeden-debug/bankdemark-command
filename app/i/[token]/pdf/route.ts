// ============================================================
// PUBLIC INVOICE PDF
//
// Same token resolution as the public page, same frozen snapshot.
// No business id or invoice id is accepted from the caller.
// ============================================================

import { NextResponse } from 'next/server';
import { resolveShareToken } from '@/lib/services/invoice-public';
import { renderInvoiceHtml, renderInvoicePdf } from '@/lib/services/invoice-document';
import { logEvent } from '@/lib/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const resolved = await resolveShareToken(params.token);
  if (!resolved) {
    return new NextResponse('Not found', { status: 404 });
  }

  const html = renderInvoiceHtml({
    invoice: resolved.invoice,
    lines: resolved.lines,
    business: resolved.business,
    client: resolved.client,
  });
  const filename = `${(resolved.invoice.number ?? 'invoice').replace(/[^\w-]/g, '')}.pdf`;

  const pdf = await renderInvoicePdf(html);

  if (pdf.ok && pdf.pdf) {
    logEvent('invoice.public_pdf', { businessId: resolved.businessId, invoiceId: resolved.invoice.id });
    return new NextResponse(new Uint8Array(pdf.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  return new NextResponse(
    html.replace(
      '</body>',
      `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script></body>`
    ),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }
  );
}

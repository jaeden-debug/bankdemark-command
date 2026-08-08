// ============================================================
// PUBLIC INVOICE PAGE
//
// The client opens this without an account. The token is resolved
// SERVER-SIDE with the service role and matched to exactly one
// invoice. `anon` has no grant on any invoice table, so there is
// nothing to enumerate even with the public key — the retired
// prototype's `USING (share_token IS NOT NULL)` policy, which exposed
// every invoice in the system, has no equivalent here.
// ============================================================

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveShareToken, recordShareView } from '@/lib/services/invoice-public';
import { renderInvoiceHtml } from '@/lib/services/invoice-document';
import { formatMinor } from '@/lib/domain/money';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  // Never leak an invoice number, client or amount into a title or
  // description, and never allow indexing.
  return {
    title: 'Invoice',
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function PublicInvoicePage({
  params,
}: {
  params: { token: string };
}) {
  const resolved = await resolveShareToken(params.token);
  if (!resolved) notFound();

  const { invoice, lines, business, client } = resolved;

  // Fire-and-forget view tracking. Deliberately awaited so a failure is
  // logged rather than becoming an unhandled rejection.
  await recordShareView(resolved.businessId, invoice.id);

  const html = renderInvoiceHtml({ invoice, lines, business, client });
  const amount = formatMinor(
    invoice.balance_minor > 0 ? invoice.balance_minor : invoice.total_minor,
    invoice.currency,
    { showMinor: true }
  );

  return (
    <main className="min-h-dvh bg-[#f6f4ef] py-6 px-3 sm:py-10">
      <div className="mx-auto max-w-[820px]">
        {/* Client-facing action bar. Not part of the document itself. */}
        <div className="bdm-no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-[#e8e3d8] bg-white/80 px-4 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#667085]">
              {invoice.status === 'paid' ? 'Paid in full' : 'Amount due'}
            </p>
            <p className="text-lg font-extrabold text-[#14181f]">
              {amount} {invoice.currency}
              {invoice.status !== 'paid' && (
                <span className="ml-2 text-xs font-semibold text-[#667085]">
                  due {invoice.due_date}
                </span>
              )}
            </p>
          </div>
          <a
            href={`/i/${params.token}/pdf`}
            // min-h-11 = 44px, the minimum comfortable touch target.
            className="inline-flex min-h-11 items-center rounded-pill bg-[#14181f] px-5 py-3 text-sm font-bold text-[#fbf7ef]"
          >
            Download PDF
          </a>
        </div>

        {/* The document, rendered from its frozen snapshot. The markup is
            produced by our own escaping renderer from structured data —
            no client-supplied HTML reaches this. */}
        <div
          className="overflow-hidden rounded-2xl border border-[#e8e3d8] bg-white shadow-[0_18px_48px_rgba(15,23,42,0.07)]"
          dangerouslySetInnerHTML={{ __html: extractBody(html) }}
        />

        <p className="bdm-no-print mt-5 text-center text-[11px] text-[#98a2b3]">
          This link is private. Prepared with BankDeMark.
        </p>
      </div>
    </main>
  );
}

/** Inline the document body without nesting a full HTML shell. */
function extractBody(html: string): string {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
  return `<style>${style}</style>${body}`;
}

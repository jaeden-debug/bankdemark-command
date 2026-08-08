import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireBusiness } from '@/lib/services/context';
import {
  getInvoiceSettings,
  listCustomFields,
  listTaxRates,
  createInvoiceFromBooking,
} from '@/lib/services/invoices';
import { formatMinor } from '@/lib/domain/money';
import InvoiceBuilder from '@/components/bdm/InvoiceBuilder';
import AiInvoiceDraft from '@/components/bdm/AiInvoiceDraft';
import { getUsageSummary } from '@/lib/services/access';

export const dynamic = 'force-dynamic';

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: { businessId: string };
  searchParams: { bookingId?: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'member');

  // Arriving from a booking: draft the commission invoice server-side
  // and continue in the editor, so the prefill is done by the same
  // service any other caller would use.
  if (searchParams.bookingId) {
    const { invoice } = await createInvoiceFromBooking(ctx, searchParams.bookingId, {
      actorType: 'user',
      source: 'manual',
    });
    redirect(`/b/${ctx.businessId}/invoices/${invoice.id}/edit`);
  }

  const [settings, customFields, taxRates, counterparties, usage] = await Promise.all([
    getInvoiceSettings(ctx),
    listCustomFields(ctx),
    listTaxRates(ctx),
    ctx.db
      .from('counterparties')
      .select('id, name, email')
      .eq('business_id', ctx.businessId)
      .eq('is_active', true)
      .in('kind', ['customer', 'other'])
      .order('name'),
    getUsageSummary(ctx),
  ]);

  const aiUsage = usage.find((u) => u.metric === 'ai_actions');
  const aiRemaining = aiUsage?.limit === null ? null : Math.max(0, (aiUsage?.limit ?? 0) - (aiUsage?.used ?? 0));

  const clients = (counterparties.data ?? []) as Array<{ id: string; name: string; email: string | null }>;
  const base = `/b/${ctx.businessId}/invoices`;

  return (
    <div className="bdm-page max-w-4xl">
      <header className="mb-5 flex items-center gap-3">
        <Link href={base} className="bdm-btn-ghost bdm-btn-sm" aria-label="Back to invoices">
          ←
        </Link>
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">New invoice</h1>
        </div>
      </header>

      {clients.length === 0 ? (
        <div className="bdm-card p-7 text-center">
          <h2 className="bdm-h2">Add a client first</h2>
          <p className="bdm-sub mx-auto mt-2 max-w-sm">
            An invoice needs someone to bill. Add the client or agency you invoice, then come back.
          </p>
          <Link
            href={`/b/${ctx.businessId}/clients?next=/b/${ctx.businessId}/invoices/new`}
            className="bdm-btn-gold mt-4"
          >
            Add a client
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {process.env.AI_API_KEY && (
            <AiInvoiceDraft businessId={ctx.businessId} remaining={aiRemaining} />
          )}
          <InvoiceBuilder
          businessId={ctx.businessId}
          currency={ctx.business.base_currency}
          identity={{
            name: settings.legal_name?.trim() || ctx.business.name,
            addressLines: [
              settings.address_line1,
              settings.address_line2,
              [settings.city, settings.region, settings.postal_code].filter(Boolean).join(', '),
            ].filter((v): v is string => Boolean(v && v.trim())),
            email: settings.email,
            taxNumber: settings.tax_number,
            taxNumberLabel: settings.tax_number_label,
          }}
          counterparties={clients}
          taxRates={taxRates}
          customFields={customFields}
          defaults={{
            paymentTerms: settings.default_payment_terms,
            notes: settings.default_notes,
            terms: settings.default_terms,
            paymentInstructions: settings.payment_instructions,
            taxCode: settings.default_tax_code,
          }}
          />
        </div>
      )}
    </div>
  );
}

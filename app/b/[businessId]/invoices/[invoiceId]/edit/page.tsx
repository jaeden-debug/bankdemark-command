import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireBusiness } from '@/lib/services/context';
import {
  getInvoice,
  getInvoiceSettings,
  listCustomFields,
  listTaxRates,
} from '@/lib/services/invoices';
import { formatMinor } from '@/lib/domain/money';
import InvoiceBuilder from '@/components/bdm/InvoiceBuilder';

export const dynamic = 'force-dynamic';

export default async function EditInvoicePage({
  params,
}: {
  params: { businessId: string; invoiceId: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'member');
  const detail = await getInvoice(ctx, params.invoiceId);

  // An issued invoice is a financial record. There is no edit screen
  // for one — the detail page offers void and credit note instead.
  if (detail.invoice.status !== 'draft') {
    redirect(`/b/${ctx.businessId}/invoices/${params.invoiceId}`);
  }

  const [settings, customFields, taxRates, counterparties] = await Promise.all([
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
  ]);

  const clients = (counterparties.data ?? []) as Array<{ id: string; name: string; email: string | null }>;
  const b = detail.booking;

  // Context from the source booking, shown so the user can see WHY the
  // amount is what it is — and that the gross value is not the total.
  const sourceNote = b
    ? `From booking ${b.reference ?? ''} · gross value ${formatMinor(
        b.gross_value_minor,
        b.currency,
        { showMinor: true }
      )}${b.commission_rate ? ` · commission ${(Number(b.commission_rate) * 100).toFixed(2).replace(/\.00$/, '')}%` : ''}. Only the line items below are billed.`.replace(
        /\s+/g,
        ' '
      )
    : null;

  return (
    <div className="bdm-page max-w-4xl">
      <header className="mb-5 flex items-center gap-3">
        <Link
          href={`/b/${ctx.businessId}/invoices/${params.invoiceId}`}
          className="bdm-btn-ghost bdm-btn-sm"
          aria-label="Back to invoice"
        >
          ←
        </Link>
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">Edit draft</h1>
        </div>
      </header>

      <InvoiceBuilder
        businessId={ctx.businessId}
        currency={detail.invoice.currency}
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
        sourceNote={sourceNote}
        existing={{
          id: detail.invoice.id,
          counterpartyId: detail.invoice.counterparty_id,
          issueDate: detail.invoice.issue_date,
          dueDate: detail.invoice.due_date,
          paymentTerms: detail.invoice.payment_terms,
          lines: detail.lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unit_price_minor: Number(l.unit_price_minor),
            tax_code: l.tax_code,
          })),
          discountKind: detail.invoice.discount_kind,
          discountValue: Number(detail.invoice.discount_value),
          notes: detail.invoice.notes,
          terms: detail.invoice.terms,
          paymentInstructions: detail.invoice.payment_instructions,
          customFields: detail.invoice.custom_fields ?? {},
        }}
      />
    </div>
  );
}

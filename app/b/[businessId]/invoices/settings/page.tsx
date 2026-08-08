import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { getInvoiceSettings, listCustomFields, listTaxRates } from '@/lib/services/invoices';
import { isEnabled, planFor } from '@/lib/services/entitlements';
import InvoiceSettingsForm from '@/components/bdm/InvoiceSettingsForm';

export const dynamic = 'force-dynamic';

export default async function InvoiceSettingsPage({
  params,
}: {
  params: { businessId: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'admin');

  const [settings, customFields, taxRates, profileRes] = await Promise.all([
    getInvoiceSettings(ctx),
    listCustomFields(ctx),
    listTaxRates(ctx),
    ctx.db.from('profiles').select('plan').eq('id', ctx.userId).maybeSingle(),
  ]);

  const plan = profileRes.data?.plan ?? 'free';
  const base = `/b/${ctx.businessId}/invoices`;

  return (
    <div className="bdm-page max-w-3xl">
      <header className="mb-5 flex items-center gap-3">
        <Link href={base} className="bdm-btn-ghost bdm-btn-sm" aria-label="Back to invoices">
          ←
        </Link>
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">Invoice settings</h1>
        </div>
      </header>

      <InvoiceSettingsForm
        businessId={ctx.businessId}
        settings={settings}
        customFields={customFields}
        taxRates={taxRates}
        planName={planFor(plan).name}
        canBrand={isEnabled(plan, 'invoice_branding')}
        canTemplate={isEnabled(plan, 'invoice_templates')}
        jurisdiction={
          ctx.business.tax_jurisdiction ??
          (ctx.business.region
            ? `${ctx.business.country}-${ctx.business.region}`
            : ctx.business.country)
        }
      />
    </div>
  );
}

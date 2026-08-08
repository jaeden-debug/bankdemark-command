import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { getInvoiceSettings, listCustomFields, listTaxRates } from '@/lib/services/invoices';
import { getAccess, can } from '@/lib/services/access';
import InvoiceSettingsForm from '@/components/bdm/InvoiceSettingsForm';
import LogoUpload from '@/components/bdm/LogoUpload';

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

  const access = await getAccess(ctx);
  const base = `/b/${ctx.businessId}/invoices`;

  // Short-lived signed URL — the bucket is private.
  let logoUrl: string | null = null;
  if (settings.logo_path) {
    const { data } = await ctx.db.storage
      .from('business-logos')
      .createSignedUrl(settings.logo_path, 600);
    logoUrl = data?.signedUrl ?? null;
  }

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

      <section className="bdm-card mb-4 p-5">
        <h2 className="bdm-h2 mb-3">Branding</h2>
        <LogoUpload
          businessId={ctx.businessId}
          initialUrl={logoUrl}
          canBrand={can(access, 'logoBranding')}
          planName={access.plan.name}
        />
      </section>

      <InvoiceSettingsForm
        businessId={ctx.businessId}
        settings={settings}
        customFields={customFields}
        taxRates={taxRates}
        planName={access.plan.name}
        canBrand={can(access, 'whiteLabel')}
        canTemplate={true}
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

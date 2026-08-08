import { requireBusiness } from '@/lib/services/context';
import { planFor } from '@/lib/services/entitlements';
import { formatMinor } from '@/lib/domain/money';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'viewer');

  const [{ data: profile }, { data: accounts }] = await Promise.all([
    ctx.db.from('profiles').select('plan, email').eq('id', ctx.userId).single(),
    ctx.db.from('accounts').select('id, name, account_kind, currency, sync_status, opening_balance_minor')
      .eq('business_id', ctx.businessId).eq('is_active', true).order('created_at'),
  ]);

  const plan = planFor(profile?.plan);
  const b = ctx.business;

  return (
    <div className="bdm-page max-w-3xl space-y-4">
      <header>
        <p className="bdm-eyebrow">{b.name}</p>
        <h1 className="bdm-h1">Settings</h1>
      </header>

      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-3">This business</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Name', b.name],
            ['Type', b.business_type.replace(/_/g, ' ')],
            ['Currency', b.base_currency],
            ['Country', b.region ? `${b.country} · ${b.region}` : b.country],
            ['Financial year starts', `Month ${b.fiscal_year_start_month}`],
            ['Earns commissions', b.earns_commissions ? 'Yes' : 'No'],
            ['Handles pass-through funds', b.handles_client_funds ? 'Yes' : 'No'],
            ['Your role', ctx.role],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="bdm-eyebrow">{k}</dt>
              <dd className="mt-0.5 text-sm font-semibold capitalize text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-3">Accounts</h2>
        <ul className="space-y-2">
          {(accounts ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-control border border-gold-line bg-white/60 px-3.5 py-2.5">
              <span>
                <span className="block text-sm font-semibold text-ink">{a.name}</span>
                <span className="block text-xs capitalize text-muted">{a.account_kind.replace(/_/g, ' ')} · {a.currency}</span>
              </span>
              <span className="bdm-badge-neutral">Manual</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Bank, Stripe and Shopify connections are being built. Today every account is recorded manually.
        </p>
      </section>

      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-1">Plan</h2>
        <p className="bdm-figure-lg mt-1">{plan.name}</p>
        <p className="mt-1.5 text-[13px] text-muted">
          {plan.monthlyPriceMinor === null
            ? 'All limits are off on this account.'
            : `${formatMinor(plan.monthlyPriceMinor, plan.currency)} per month.`}
        </p>
      </section>
    </div>
  );
}

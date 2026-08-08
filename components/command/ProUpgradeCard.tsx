'use client';

import { PLAN_MARKETING, PLANS, ROADMAP_NOT_SOLD } from '@/lib/services/entitlements';
import { formatMinor } from '@/lib/domain/money';

// ============================================================
// Every line rendered here is derived from the entitlements table,
// which is what the server actually enforces.
//
// The previous version advertised eight "Pro Adds" — unlimited AI,
// scenario simulations, a couple & family dashboard, a business
// module, alerts, tax planning mode, PDF export and priority support.
// None were gated; several did not exist. Checkout took $19/$149/$299
// and granted nothing.
//
// Purchase is therefore disabled until Stripe prices are mapped to the
// new plan ids and the webhook writes an enforced plan. Feature lists
// can no longer drift from enforcement because they are the same data.
// ============================================================

const CHECKOUT_ENABLED = false;

const freeFeatures = PLAN_MARKETING.filter((f) => f.plans.includes('free')).map((f) => f.label);
const starterAdds = PLAN_MARKETING.filter(
  (f) => f.plans.includes('starter') && !f.plans.includes('free')
).map((f) => f.label);
const businessAdds = PLAN_MARKETING.filter(
  (f) => f.plans.includes('business') && !f.plans.includes('starter')
).map((f) => f.label);

function price(planId: 'starter' | 'business'): string {
  const plan = PLANS[planId];
  return plan.monthlyPriceMinor === null
    ? '—'
    : formatMinor(plan.monthlyPriceMinor, plan.currency);
}

export default function ProUpgradeCard({ inline = false }: { inline?: boolean }) {
  if (inline) {
    return (
      <div className="bdm-card flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-bold text-ink">More businesses, more automation</p>
          <p className="mt-0.5 text-xs text-muted">
            Paid plans are being finalised. Everything you can see today is free.
          </p>
        </div>
        <a href="/command/marketplace#plans" className="bdm-btn-secondary whitespace-nowrap text-sm">
          See plans
        </a>
      </div>
    );
  }

  return (
    <section id="plans" className="bdm-card p-6">
      <header className="mb-5">
        <p className="bdm-eyebrow">Plans</p>
        <h2 className="bdm-h2 mt-1">What each plan includes</h2>
        <p className="bdm-sub mt-1.5">
          Financial accuracy is never limited. Every plan shows your real numbers. Paid plans raise
          limits on scale and automation.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <PlanColumn name="Free" priceLabel="$0" caption="Everything you need for one business." features={freeFeatures} />
        <PlanColumn
          name="Starter"
          priceLabel={`${price('starter')}/mo`}
          caption="More history, research and receipts."
          features={starterAdds}
          prefix="Everything in Free, plus"
          highlight
        />
        <PlanColumn
          name="Business"
          priceLabel={`${price('business')}/mo`}
          caption="Several businesses and your accountant."
          features={businessAdds}
          prefix="Everything in Starter, plus"
        />
      </div>

      <div className="mt-6 rounded-panel border border-gold-line bg-gold-tint p-4">
        <p className="text-sm font-bold text-ink">Not built yet — and not sold</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          These are on the roadmap. They are listed here so nobody pays for something that does not
          exist:
        </p>
        <ul className="mt-2 space-y-1">
          {ROADMAP_NOT_SOLD.map((item) => (
            <li key={item} className="text-[13px] text-muted">— {item}</li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        {CHECKOUT_ENABLED ? null : (
          <p className="rounded-control border border-gold-line bg-white/60 px-4 py-3 text-center text-[13px] text-muted">
            Paid plans are not open for purchase yet. Everything currently in BankDeMark is available
            free while the billing setup is completed.
          </p>
        )}
      </div>
    </section>
  );
}

function PlanColumn({
  name,
  priceLabel,
  caption,
  features,
  prefix,
  highlight,
}: {
  name: string;
  priceLabel: string;
  caption: string;
  features: string[];
  prefix?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-panel border p-4 ${highlight ? 'border-gold/45 bg-white/75' : 'border-gold-line bg-white/50'}`}>
      <p className="text-sm font-bold text-ink">{name}</p>
      <p className="bdm-figure-lg mt-1">{priceLabel}</p>
      <p className="mt-1 text-xs text-muted">{caption}</p>
      {prefix && <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-gold-dark">{prefix}</p>}
      <ul className="mt-2 space-y-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink">
            <span aria-hidden className="mt-0.5 text-gold">✓</span>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

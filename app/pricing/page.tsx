import Link from 'next/link';
import { PLANS, PURCHASABLE_PLANS, formatPlanPrice } from '@/lib/config/plans';
import PricingActions from '@/components/bdm/PricingActions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pricing — BankDeMark Invoicing',
  description: 'Create and send professional invoices. Plans from free to $49 CAD a month.',
};

export default function PricingPage({ searchParams }: { searchParams: { checkout?: string } }) {
  return (
    <main className="bdm-page max-w-6xl">
      <header className="mx-auto mb-8 max-w-xl text-center">
        <Link href="/" className="text-[20px] font-extrabold tracking-brand">
          <span className="text-ink">Bank</span><span className="text-gold">DeMark</span>
        </Link>
        <h1 className="bdm-h1 mt-4">Invoicing that gets you paid</h1>
        <p className="bdm-sub mt-2">
          Start free. Upgrade when you need more. Prices in CAD, cancel any time.
        </p>
      </header>

      {searchParams.checkout === 'cancelled' && (
        <div role="status" className="mx-auto mb-6 max-w-lg rounded-panel border border-gold-line bg-white/70 p-4 text-center">
          <p className="text-sm font-semibold text-ink">Checkout cancelled — nothing was charged.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {PURCHASABLE_PLANS.map((id) => {
          const plan = PLANS[id];
          const highlight = id === 'pro';
          return (
            <section
              key={id}
              className={`bdm-card flex flex-col p-6 ${highlight ? 'ring-2 ring-gold' : ''}`}
              aria-labelledby={`plan-${id}`}
            >
              {highlight && (
                <span className="bdm-badge-gold mb-3 self-start">Most popular</span>
              )}
              <h2 id={`plan-${id}`} className="bdm-h2">{plan.name}</h2>
              <p className="bdm-sub mt-1 min-h-[40px] text-xs">{plan.tagline}</p>

              <p className="mt-3">
                <span className="bdm-figure-xl bdm-num">{formatPlanPrice(plan)}</span>
                {plan.priceMinor ? (
                  <span className="ml-1 text-sm text-muted">CAD/month</span>
                ) : null}
              </p>

              <ul className="mt-5 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm text-ink">
                    <span aria-hidden className="text-gold">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <PricingActions planId={id} />
              </div>
            </section>
          );
        })}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted">
        Every plan keeps permanent access to invoices you have already issued, including their PDFs,
        even if you downgrade. Your financial records are yours.
      </p>
    </main>
  );
}

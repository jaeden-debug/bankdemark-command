'use client';

import { useState } from 'react';

const FREE_FEATURES = [
  'Financial health dashboard',
  'Core metric calculations',
  'Basic AI coach (5 questions/day)',
  'Debt & wealth engines',
  'Basic reports',
];

const PRO_FEATURES = [
  'Unlimited AI coach with deep context',
  'Advanced scenario simulations',
  'Couple & family dashboard',
  'Business finance module',
  'Wealth & debt alerts',
  'Tax planning mode',
  'PDF export for all reports',
  'Priority support',
];

export default function ProUpgradeCard({ inline = false }: { inline?: boolean }) {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');
  const [loadingPlan, setLoadingPlan] = useState<'monthly' | 'yearly' | 'lifetime' | null>(null);

  async function startCheckout(plan: 'monthly' | 'yearly' | 'lifetime') {
    try {
      setLoadingPlan(plan);

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Unable to start checkout.');
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      alert(error?.message || 'Unable to start checkout.');
    } finally {
      setLoadingPlan(null);
    }
  }

  const price = billing === 'monthly' ? '$19' : '$149';
  const period = billing === 'monthly' ? '/month' : '/year';
  const savings = billing === 'yearly' ? 'Save $79 vs monthly' : null;

  if (inline) {
    return (
      <div className="glass-card p-4 border-brand-gold/20 bg-brand-gold/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-400 text-sm">✦</span>
            <span className="text-sm font-semibold text-yellow-300">Upgrade to BankDeMark Pro</span>
          </div>
          <p className="text-xs text-zinc-400">Unlock advanced AI, PDF reports, scenarios & more.</p>
        </div>
          <a
            href="/command/marketplace#pro"
            className="cmd-btn-primary text-sm whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #F5C842, #C9A230)' }}
          >
            See Pro Plans
          </a>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 border-brand-gold/20 bg-gradient-to-br from-yellow-900/10 to-transparent">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400">✦</span>
        <h3 className="font-bold text-lg text-white">BankDeMark Pro</h3>
        <span className="text-xs bg-yellow-400/20 text-yellow-300 px-2 py-0.5 rounded-full font-medium">
          EARLY ACCESS
        </span>
      </div>
      <p className="text-zinc-400 text-sm mb-5">
        Everything in Free, plus advanced tools for serious financial optimization.
      </p>

      {/* Billing toggle */}
      <div className="flex items-center gap-2 mb-5">
        <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5">
          <button
            onClick={() => setBilling('monthly')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${billing === 'monthly' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('yearly')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${billing === 'yearly' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            Yearly
          </button>
        </div>
        {savings && (
          <span className="text-xs text-emerald-400 font-medium">{savings}</span>
        )}
      </div>

      {/* Pricing */}
      <div className="flex items-baseline gap-1 mb-5">
        <span className="text-3xl font-bold text-white">{price}</span>
        <span className="text-zinc-400 text-sm">{period}</span>
      </div>

      {/* Feature comparison */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wide mb-2">Free Includes</p>
          <ul className="space-y-1.5">
            {FREE_FEATURES.map(f => (
              <li key={f} className="text-sm text-zinc-400 flex items-start gap-2">
                <span className="text-zinc-600 mt-0.5">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wide mb-2">Pro Adds</p>
          <ul className="space-y-1.5">
            {PRO_FEATURES.map(f => (
              <li key={f} className="text-sm text-yellow-200/80 flex items-start gap-2">
                <span className="text-yellow-400 mt-0.5">✦</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          className="flex-1 py-3 rounded-xl font-semibold text-sm text-center transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #F5C842, #C9A230)', color: '#080C14' }}
          onClick={() => startCheckout(billing)}
          disabled={loadingPlan !== null}
        >
          {loadingPlan === billing ? 'Opening checkout…' : `Start Pro — ${price}${period}`}
        </button>
          <button
            type="button"
            className="flex-1 py-3 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-sm font-semibold text-yellow-200 transition-all hover:bg-yellow-400/15 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => startCheckout('lifetime')}
            disabled={loadingPlan !== null}
          >
            {loadingPlan === 'lifetime' ? 'Opening checkout…' : 'Lifetime — $299 one-time'}
          </button>
      </div>

      <p className="text-xs  text-zinc-300/80 mt-3 text-center">
          Secure checkout powered by Stripe. Cancel anytime.
      </p>
    </div>
  );
}

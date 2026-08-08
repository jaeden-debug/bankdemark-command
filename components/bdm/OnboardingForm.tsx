'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const BUSINESS_TYPES = [
  { id: 'travel',     label: 'Travel advisor or agency',        hint: 'You sell trips and earn commission from suppliers.' },
  { id: 'agency',     label: 'Agency or professional services', hint: 'You deliver projects or retainers for clients.' },
  { id: 'ecommerce',  label: 'Online store',                    hint: 'You sell physical or digital products online.' },
  { id: 'saas',       label: 'Software or subscriptions',       hint: 'You charge recurring fees for a product.' },
  { id: 'freelancer', label: 'Freelancer or consultant',        hint: 'You invoice clients for your own time and work.' },
  { id: 'retail',     label: 'Retail or in-person',             hint: 'You sell from a location.' },
  { id: 'creator',    label: 'Creator or media',                hint: 'You earn from content, sponsorship or products.' },
  { id: 'holding',    label: 'Umbrella or holding company',     hint: 'You run several brands under one company.' },
  { id: 'other',      label: 'Something else',                  hint: "We'll keep it simple and general." },
];

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];

const REGIONS: Record<string, string[]> = {
  CA: ['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Nova Scotia','Ontario','Prince Edward Island','Quebec','Saskatchewan','Northwest Territories','Nunavut','Yukon'],
  US: ['California','Florida','Illinois','New York','Texas','Washington','Other'],
};

export default function OnboardingForm({ isFirst }: { isFirst: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [brandModel, setBrandModel] = useState<'none' | 'brands' | 'group'>('none');
  const [brandNames, setBrandNames] = useState<string[]>(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [country, setCountry] = useState('CA');
  const [region, setRegion] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('CAD');
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);
  const [earnsCommissions, setEarnsCommissions] = useState(false);
  const [handlesClientFunds, setHandlesClientFunds] = useState(false);

  function pickType(id: string) {
    setBusinessType(id);
    // Sensible defaults the owner can still change on the next step.
    if (id === 'travel') {
      setEarnsCommissions(true);
      setHandlesClientFunds(true);
    }
    if (id === 'holding') setBrandModel('brands');
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, businessType, country, region: region || null, baseCurrency,
          fiscalYearStartMonth, earnsCommissions, handlesClientFunds,
          brandModel,
          brands: brandModel === 'brands' ? brandNames.filter((b) => b.trim()) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not create that business.');
      router.push(`/b/${data.business.id}/dashboard`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  const canContinue = step === 1 ? name.trim().length > 0 && businessType : true;

  return (
    <div className="bdm-card p-6 sm:p-7">
      <div className="mb-5 flex items-center gap-2" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-1 flex-1 rounded-pill ${n <= step ? 'bg-gold' : 'bg-ink/10'}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <p className="bdm-eyebrow">Step 1 of 3</p>
            <h1 className="bdm-h1 mt-1">What are we keeping books for?</h1>
            <p className="bdm-sub mt-1.5">
              Each business gets its own separate books. Nothing mixes between them.
            </p>
          </div>

          <div>
            <label className="bdm-label" htmlFor="biz-name">Business name</label>
            <input
              id="biz-name"
              className="bdm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="TravelDesign By Lisa"
              autoFocus
            />
          </div>

          <fieldset>
            <legend className="bdm-label">What kind of business is it?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {BUSINESS_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickType(t.id)}
                  aria-pressed={businessType === t.id}
                  className={`rounded-control border p-3 text-left transition-all ${
                    businessType === t.id
                      ? 'border-gold bg-gold-tint'
                      : 'border-gold-line bg-white/60 hover:border-gold/45'
                  }`}
                >
                  <span className="block text-sm font-bold text-ink">{t.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{t.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <p className="bdm-eyebrow">Step 2 of 3</p>
            <h1 className="bdm-h1 mt-1">How your money works</h1>
            <p className="bdm-sub mt-1.5">
              This tells BankDeMark how to read your numbers correctly. You can change any of it later.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="bdm-label" htmlFor="country">Country</label>
              <select id="country" className="bdm-select" value={country}
                      onChange={(e) => { setCountry(e.target.value); setRegion(''); setBaseCurrency(e.target.value === 'US' ? 'USD' : 'CAD'); }}>
                <option value="CA">Canada</option>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="AU">Australia</option>
                <option value="OT">Somewhere else</option>
              </select>
            </div>

            <div>
              <label className="bdm-label" htmlFor="currency">Currency</label>
              <select id="currency" className="bdm-select" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="bdm-hint">All figures for this business are reported in this currency.</span>
            </div>

            {REGIONS[country] && (
              <div>
                <label className="bdm-label" htmlFor="region">Province or state</label>
                <select id="region" className="bdm-select" value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">Not sure yet</option>
                  {REGIONS[country].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="bdm-label" htmlFor="fiscal">Financial year starts</label>
              <select id="fiscal" className="bdm-select" value={fiscalYearStartMonth}
                      onChange={(e) => setFiscalYearStartMonth(Number(e.target.value))}>
                {['January','February','March','April','May','June','July','August','September','October','November','December']
                  .map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          <fieldset className="space-y-2.5 rounded-panel border border-gold-line bg-white/50 p-4">
            <legend className="px-1 text-[13px] font-semibold text-ink">A couple of questions</legend>

            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 accent-[#c6a24a]" checked={earnsCommissions}
                     onChange={(e) => setEarnsCommissions(e.target.checked)} />
              <span>
                <span className="block text-sm font-semibold text-ink">I earn commissions on what I sell</span>
                <span className="block text-xs leading-relaxed text-muted">
                  If you sell a $6,000 trip and earn $600, we&apos;ll report $6,000 booked and $600 earned —
                  not $6,000 of revenue.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 accent-[#c6a24a]" checked={handlesClientFunds}
                     onChange={(e) => setHandlesClientFunds(e.target.checked)} />
              <span>
                <span className="block text-sm font-semibold text-ink">
                  Money passes through my account that isn&apos;t mine
                </span>
                <span className="block text-xs leading-relaxed text-muted">
                  Client or supplier funds you collect and pass on. We&apos;ll keep those out of your revenue.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div>
            <p className="bdm-eyebrow">Step 3 of 3</p>
            <h1 className="bdm-h1 mt-1">Does this run more than one brand?</h1>
            <p className="bdm-sub mt-1.5">
              This decides how your books are kept, so it is worth getting right. You can change it later.
            </p>
          </div>

          <div className="space-y-2">
            {([
              ['none', 'Just this one', 'One name, one set of books. The simplest setup.'],
              ['brands', 'Several brands under this one company',
               'They all get filed under this company — one bank account, one tax return. We keep one set of books and let you see each brand separately.'],
              ['group', 'Separate companies, each files its own return',
               'Each one is its own registered business. They each need their own books, so you will create them separately. We will still show a combined view.'],
            ] as const).map(([id, label, hint]) => (
              <button
                key={id}
                type="button"
                onClick={() => setBrandModel(id)}
                aria-pressed={brandModel === id}
                className={`w-full rounded-control border p-3.5 text-left transition-all ${
                  brandModel === id ? 'border-gold bg-gold-tint' : 'border-gold-line bg-white/60 hover:border-gold/45'
                }`}
              >
                <span className="block text-sm font-bold text-ink">{label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>
              </button>
            ))}
          </div>

          {brandModel === 'brands' && (
            <fieldset className="rounded-panel border border-gold-line bg-white/50 p-4">
              <legend className="px-1 text-[13px] font-semibold text-ink">What are they called?</legend>
              <p className="mb-3 text-xs leading-relaxed text-muted">
                Every transaction can be tagged with a brand, so you will see revenue and profit per brand
                while the books stay as one filing.
              </p>
              <div className="space-y-2">
                {brandNames.map((value, i) => (
                  <div key={i}>
                    <label className="sr-only" htmlFor={`brand-${i}`}>Brand {i + 1}</label>
                    <input
                      id={`brand-${i}`}
                      className="bdm-input"
                      value={value}
                      placeholder={i === 0 ? 'Blackwater Aquatics' : i === 1 ? 'Zylx' : 'Another brand'}
                      onChange={(e) =>
                        setBrandNames((prev) => prev.map((b, j) => (j === i ? e.target.value : b)))
                      }
                    />
                  </div>
                ))}
              </div>
              {brandNames.length < 12 && (
                <button type="button" className="bdm-btn-ghost bdm-btn-sm mt-2"
                        onClick={() => setBrandNames((prev) => [...prev, ''])}>
                  + Add another brand
                </button>
              )}
            </fieldset>
          )}

          {brandModel === 'group' && (
            <p className="rounded-control border border-gold-line bg-gold-tint px-3.5 py-3 text-[13px] leading-relaxed text-ink">
              We will set up <strong className="font-bold">{name || 'this business'}</strong> first. Add the
              others from the business switcher afterwards — each keeps completely separate books, and the
              portfolio view shows them side by side.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-control border border-negative/25 bg-negative-soft px-3.5 py-2.5 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        {step > 1 ? (
          <button type="button" className="bdm-btn-ghost" onClick={() => setStep(step - 1)} disabled={submitting}>
            Back
          </button>
        ) : <span />}

        {step < 3 ? (
          <button type="button" className="bdm-btn-primary" onClick={() => setStep(step + 1)} disabled={!canContinue}>
            Continue
          </button>
        ) : (
          <button type="button" className="bdm-btn-gold" onClick={submit} disabled={submitting}>
            {submitting ? 'Setting up…' : 'Create business'}
          </button>
        )}
      </div>
    </div>
  );
}

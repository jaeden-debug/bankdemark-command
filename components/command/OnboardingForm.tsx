'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { createClient } from '@/lib/supabase/client';
import type { OnboardingData, UserType, HouseholdType, RiskTolerance, CreditScoreRange, PrimaryGoal } from '@/lib/command/types';
import {
  USER_TYPE_LABELS,
  HOUSEHOLD_TYPE_LABELS,
  RISK_TOLERANCE_LABELS,
  CREDIT_SCORE_LABELS,
  PRIMARY_GOAL_LABELS,
} from '@/lib/command/constants';

const STEPS = [
  { id: 1, title: 'About You', subtitle: 'Tell us who you are' },
  { id: 2, title: 'Income & Expenses', subtitle: 'Your monthly money flow' },
  { id: 3, title: 'Debt & Credit', subtitle: 'Your debt picture' },
  { id: 4, title: 'Savings & Investments', subtitle: 'What you have saved' },
  { id: 5, title: 'Goals & Risk', subtitle: 'Where you want to go' },
];

const EMPTY: OnboardingData = {
  first_name: '', age: '', country: 'Canada', region: '',
  user_type: '', household_type: '',
  monthly_income: '', fixed_expenses: '', variable_expenses: '', housing_payment: '',
  business_owner: false, business_revenue: '', business_expenses: '',
  total_debt: '', average_debt_interest: '', minimum_debt_payment: '', credit_score_range: '',
  savings_balance: '', investment_balance: '', emergency_fund_target_months: '6',
  primary_goal: '', secondary_goal: '', desired_retirement_age: '65',
  passive_income_target: '', risk_tolerance: '',
};

const COUNTRIES = ['Canada', 'United States', 'United Kingdom', 'Australia', 'Other'];
const CA_PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function numField(val: string): number {
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}
function Field({ label, hint, children }: FieldProps) {
  return (
    <div>
      <label className="cmd-label">{label}</label>
      {hint && <p className="text-xs text-zinc-600 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

interface MoneyInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}
function MoneyInput({ value, onChange, placeholder = '0', disabled }: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">$</span>
      <input
        type="number"
        className="cmd-input pl-7"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min="0"
        step="1"
        disabled={disabled}
      />
    </div>
  );
}

export default function OnboardingForm() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const set = (key: keyof OnboardingData, value: string | boolean) =>
    setData(d => ({ ...d, [key]: value }));

  // Load existing data
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/command'); return; }
      setUserId(user.id);
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('financial_snapshots').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).single(),
      ]);
      if (p) {
        setData(d => ({
          ...d,
          first_name: p.first_name ?? '',
          age: p.age?.toString() ?? '',
          country: p.country ?? 'Canada',
          region: p.region ?? '',
          user_type: (p.user_type ?? '') as UserType | '',
          household_type: (p.household_type ?? '') as HouseholdType | '',
          business_owner: p.business_owner ?? false,
        }));
      }
      if (s) {
        setData(d => ({
          ...d,
          monthly_income: s.monthly_income?.toString() ?? '',
          fixed_expenses: s.fixed_expenses?.toString() ?? '',
          variable_expenses: s.variable_expenses?.toString() ?? '',
          housing_payment: s.housing_payment?.toString() ?? '',
          total_debt: s.total_debt?.toString() ?? '',
          average_debt_interest: s.average_debt_interest?.toString() ?? '',
          minimum_debt_payment: s.minimum_debt_payment?.toString() ?? '',
          savings_balance: s.savings_balance?.toString() ?? '',
          investment_balance: s.investment_balance?.toString() ?? '',
          emergency_fund_target_months: s.emergency_fund_target_months?.toString() ?? '6',
          credit_score_range: (s.credit_score_range ?? '') as CreditScoreRange | '',
          primary_goal: (s.primary_goal ?? '') as PrimaryGoal | '',
          secondary_goal: (s.secondary_goal ?? '') as PrimaryGoal | '',
          desired_retirement_age: s.desired_retirement_age?.toString() ?? '65',
          passive_income_target: s.passive_income_target?.toString() ?? '',
          risk_tolerance: (s.risk_tolerance ?? '') as RiskTolerance | '',
          business_revenue: s.business_revenue?.toString() ?? '',
          business_expenses: s.business_expenses?.toString() ?? '',
        }));
      }
    })();
  }, [supabase, router]);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const profilePayload = {
        id: userId,
        email: user?.email ?? '',
        first_name: data.first_name,
        age: parseInt(data.age) || 0,
        country: data.country,
        region: data.region,
        user_type: data.user_type,
        household_type: data.household_type,
        business_owner: data.business_owner,
        updated_at: new Date().toISOString(),
      };
      const snapshotPayload = {
        user_id: userId,
        monthly_income: numField(data.monthly_income),
        fixed_expenses: numField(data.fixed_expenses),
        variable_expenses: numField(data.variable_expenses),
        housing_payment: numField(data.housing_payment),
        total_debt: numField(data.total_debt),
        average_debt_interest: numField(data.average_debt_interest),
        minimum_debt_payment: numField(data.minimum_debt_payment),
        savings_balance: numField(data.savings_balance),
        investment_balance: numField(data.investment_balance),
        emergency_fund_target_months: numField(data.emergency_fund_target_months) || 6,
        credit_score_range: data.credit_score_range,
        primary_goal: data.primary_goal,
        secondary_goal: data.secondary_goal || null,
        desired_retirement_age: parseInt(data.desired_retirement_age) || 65,
        passive_income_target: numField(data.passive_income_target),
        risk_tolerance: data.risk_tolerance,
        business_revenue: data.business_owner ? numField(data.business_revenue) : null,
        business_expenses: data.business_owner ? numField(data.business_expenses) : null,
        updated_at: new Date().toISOString(),
      };
      const [profileRes, snapshotRes] = await Promise.all([
        supabase.from('profiles').upsert(profilePayload),
        supabase.from('financial_snapshots').upsert(snapshotPayload, { onConflict: 'user_id' }),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (snapshotRes.error) throw snapshotRes.error;
      router.push('/command/dashboard');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const canProceed = (): boolean => {
    if (step === 1) return !!(data.first_name && data.age && data.user_type && data.household_type);
    if (step === 2) return !!(data.monthly_income);
    if (step === 3) return true; // Debt info is optional
    if (step === 4) return true; // Savings optional
    if (step === 5) return !!(data.primary_goal && data.risk_tolerance);
    return true;
  };

  const regions = data.country === 'Canada' ? CA_PROVINCES : data.country === 'United States' ? US_STATES : [];

  return (
    <div className="min-h-screen bg-surface-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-green to-brand-blue flex items-center justify-center text-white font-bold text-sm">B</div>
            <span className="font-bold text-white">BankDeMark Command</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Set Up Your Financial Profile</h1>
          <p className="text-zinc-500 text-sm">Your data is private and never sold. Takes about 5 minutes.</p>
        </div>

        {/* Step progress */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1 flex-1">
              <button
                onClick={() => { if (s.id < step) setStep(s.id); }}
                className={clsx(
                  'w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 transition-all',
                  s.id === step ? 'bg-brand-green text-white shadow-glow' :
                  s.id < step ? 'bg-brand-green/30 text-brand-green' :
                  'bg-white/5 text-zinc-600'
                )}
              >
                {s.id < step ? '✓' : s.id}
              </button>
              {i < STEPS.length - 1 && (
                <div className={clsx('flex-1 h-0.5 rounded-full', s.id < step ? 'bg-brand-green/40' : 'bg-white/5')} />
              )}
            </div>
          ))}
        </div>

        {/* Step info */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-white">{STEPS[step - 1].title}</h2>
          <p className="text-sm text-zinc-500">{STEPS[step - 1].subtitle}</p>
        </div>

        {/* Step content */}
        <div className="glass-card p-6 mb-4 space-y-5">
          {/* ── STEP 1: About You ── */}
          {step === 1 && (
            <>
              <Field label="First Name">
                <input className="cmd-input" value={data.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Your first name" />
              </Field>
              <Field label="Age">
                <input className="cmd-input" type="number" value={data.age} onChange={e => set('age', e.target.value)} placeholder="e.g. 32" min="16" max="100" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Country">
                  <select className="cmd-select" value={data.country} onChange={e => set('country', e.target.value)}>
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                {regions.length > 0 && (
                  <Field label="Province / State">
                    <select className="cmd-select" value={data.region} onChange={e => set('region', e.target.value)}>
                      <option value="">Select…</option>
                      {regions.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <Field label="I am a…">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => set('user_type', key)}
                      className={clsx(
                        'text-left px-3 py-3 rounded-xl border text-sm font-medium transition-all',
                        data.user_type === key
                          ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                          : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/16'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Household Type">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(HOUSEHOLD_TYPE_LABELS) as [HouseholdType, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => set('household_type', key)}
                      className={clsx(
                        'text-left px-3 py-2.5 rounded-xl border text-sm font-medium transition-all',
                        data.household_type === key
                          ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                          : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/16'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Business Owner?">
                <div className="flex gap-3">
                  {[true, false].map(v => (
                    <button
                      key={String(v)}
                      type="button"
                      onClick={() => set('business_owner', v)}
                      className={clsx(
                        'flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all',
                        data.business_owner === v
                          ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                          : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/16'
                      )}
                    >
                      {v ? 'Yes, I own a business' : 'No'}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {/* ── STEP 2: Income & Expenses ── */}
          {step === 2 && (
            <>
              <Field label="Monthly Take-Home Income" hint="Your after-tax monthly income (salary, wages, etc.)">
                <MoneyInput value={data.monthly_income} onChange={v => set('monthly_income', v)} placeholder="e.g. 5000" />
              </Field>
              <div className="p-3 rounded-lg bg-white/3 border border-white/6 text-xs text-zinc-500">
                <strong className="text-zinc-400">Expense tips:</strong> Fixed = rent, insurance, subscriptions, car payment. Variable = groceries, gas, dining, entertainment.
              </div>
              <Field label="Monthly Fixed Expenses" hint="Recurring, predictable costs (not housing or debt)">
                <MoneyInput value={data.fixed_expenses} onChange={v => set('fixed_expenses', v)} placeholder="e.g. 800" />
              </Field>
              <Field label="Monthly Variable Expenses" hint="Spending that changes month to month">
                <MoneyInput value={data.variable_expenses} onChange={v => set('variable_expenses', v)} placeholder="e.g. 1200" />
              </Field>
              <Field label="Rent or Mortgage Payment" hint="Your monthly housing cost">
                <MoneyInput value={data.housing_payment} onChange={v => set('housing_payment', v)} placeholder="e.g. 1800" />
              </Field>
              {data.business_owner && (
                <>
                  <div className="border-t border-white/6 pt-4">
                    <p className="text-sm font-semibold text-yellow-400 mb-3">Business Financials</p>
                  </div>
                  <Field label="Monthly Business Revenue" hint="Gross revenue before expenses">
                    <MoneyInput value={data.business_revenue} onChange={v => set('business_revenue', v)} placeholder="e.g. 8000" />
                  </Field>
                  <Field label="Monthly Business Expenses" hint="Operating costs, not your salary">
                    <MoneyInput value={data.business_expenses} onChange={v => set('business_expenses', v)} placeholder="e.g. 2000" />
                  </Field>
                </>
              )}
            </>
          )}

          {/* ── STEP 3: Debt & Credit ── */}
          {step === 3 && (
            <>
              <div className="p-3 rounded-lg bg-white/3 border border-white/6 text-xs text-zinc-500">
                Enter your combined total debt here. You can add itemized debts in the Debt Engine for more precise payoff strategies.
              </div>
              <Field label="Total Debt Balance" hint="All debt combined: credit cards, car, student loans, personal loans (not mortgage if you want)">
                <MoneyInput value={data.total_debt} onChange={v => set('total_debt', v)} placeholder="0 if debt-free" />
              </Field>
              <Field label="Average Interest Rate (%)" hint="Blended average across all your debts">
                <div className="relative">
                  <input
                    type="number"
                    className="cmd-input pr-8"
                    value={data.average_debt_interest}
                    onChange={e => set('average_debt_interest', e.target.value)}
                    placeholder="e.g. 19.9"
                    min="0" max="100" step="0.1"
                  />
                  <span className="absolute right-3 top-1/2 -tranzinc-y-1/2 text-zinc-500 text-sm">%</span>
                </div>
              </Field>
              <Field label="Total Minimum Monthly Payments" hint="Sum of all minimums you must pay each month">
                <MoneyInput value={data.minimum_debt_payment} onChange={v => set('minimum_debt_payment', v)} placeholder="0" />
              </Field>
              <Field label="Credit Score Range">
                <div className="space-y-2">
                  {(Object.entries(CREDIT_SCORE_LABELS) as [CreditScoreRange, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => set('credit_score_range', key)}
                      className={clsx(
                        'w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all',
                        data.credit_score_range === key
                          ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                          : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/16'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {/* ── STEP 4: Savings & Investments ── */}
          {step === 4 && (
            <>
              <Field label="Total Savings Balance" hint="All liquid savings accounts, chequing, GICs">
                <MoneyInput value={data.savings_balance} onChange={v => set('savings_balance', v)} placeholder="e.g. 5000" />
              </Field>
              <Field label="Total Investment Balance" hint="TFSA, RRSP, FHSA, brokerage, retirement accounts">
                <MoneyInput value={data.investment_balance} onChange={v => set('investment_balance', v)} placeholder="e.g. 15000" />
              </Field>
              <Field label="Emergency Fund Target (Months)" hint="How many months of expenses you want in reserve">
                <select
                  className="cmd-select"
                  value={data.emergency_fund_target_months}
                  onChange={e => set('emergency_fund_target_months', e.target.value)}
                >
                  <option value="1">1 month (minimum)</option>
                  <option value="3">3 months (standard)</option>
                  <option value="6">6 months (recommended)</option>
                  <option value="9">9 months (conservative)</option>
                  <option value="12">12 months (business owners, freelancers)</option>
                </select>
              </Field>
            </>
          )}

          {/* ── STEP 5: Goals & Risk ── */}
          {step === 5 && (
            <>
              <Field label="Primary Financial Goal">
                <div className="space-y-2">
                  {(Object.entries(PRIMARY_GOAL_LABELS) as [PrimaryGoal, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => set('primary_goal', key)}
                      className={clsx(
                        'w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all',
                        data.primary_goal === key
                          ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                          : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/16'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Secondary Goal (optional)">
                <select className="cmd-select" value={data.secondary_goal} onChange={e => set('secondary_goal', e.target.value)}>
                  <option value="">None</option>
                  {(Object.entries(PRIMARY_GOAL_LABELS) as [PrimaryGoal, string][])
                    .filter(([k]) => k !== data.primary_goal)
                    .map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Target Retirement Age">
                  <input
                    type="number"
                    className="cmd-input"
                    value={data.desired_retirement_age}
                    onChange={e => set('desired_retirement_age', e.target.value)}
                    min="30" max="90"
                  />
                </Field>
                <Field label="Monthly Passive Income Target" hint="How much/mo you want from investments">
                  <MoneyInput value={data.passive_income_target} onChange={v => set('passive_income_target', v)} placeholder="e.g. 3000" />
                </Field>
              </div>
              <Field label="Investment Risk Tolerance">
                <div className="space-y-2">
                  {(Object.entries(RISK_TOLERANCE_LABELS) as [RiskTolerance, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => set('risk_tolerance', key)}
                      className={clsx(
                        'w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all',
                        data.risk_tolerance === key
                          ? 'bg-brand-green/15 border-brand-green/40 text-brand-green'
                          : 'bg-white/3 border-white/8 text-zinc-400 hover:border-white/16'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : router.push('/command/dashboard')}
            className="cmd-btn-secondary px-6 py-3"
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          <div className="text-xs text-zinc-600">
            Step {step} of {STEPS.length}
          </div>
          {step < STEPS.length ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="cmd-btn-primary px-6 py-3"
              disabled={!canProceed()}
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={save}
              className="cmd-btn-primary px-6 py-3"
              disabled={saving || !canProceed()}
            >
              {saving ? 'Saving…' : 'Save & See Dashboard'}
            </button>
          )}
        </div>

        <p className="text-center text-xs text-zinc-600 mt-4">
          Your data is stored securely in your private Supabase account. Never sold or shared.
        </p>
      </div>
    </div>
  );
}

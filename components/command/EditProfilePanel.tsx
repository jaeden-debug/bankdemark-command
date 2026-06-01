'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import LegalDisclaimer from './LegalDisclaimer';

interface ProfileData {
  first_name: string;
  age: string;
  country: string;
  region: string;
  user_type: string;
  household_type: string;
  business_owner: boolean;
}

interface SnapshotData {
  monthly_income: string;
  monthly_expenses: string;
  monthly_savings: string;
  total_savings: string;
  total_investments: string;
  total_debt: string;
  credit_score: string;
  emergency_fund: string;
  monthly_debt_payments: string;
}

const USER_TYPES = [
  { value: 'individual',    label: 'Individual' },
  { value: 'student',       label: 'Student' },
  { value: 'couple',        label: 'Couple' },
  { value: 'family',        label: 'Family' },
  { value: 'freelancer',    label: 'Freelancer / Self-Employed' },
  { value: 'small_business',label: 'Small Business Owner' },
  { value: 'investor',      label: 'Investor' },
  { value: 'retiree',       label: 'Retiree' },
];

export default function EditProfilePanel() {
  const supabase = createClient();
  const [tab, setTab] = useState<'identity' | 'finances'>('identity');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [profile, setProfile] = useState<ProfileData>({
    first_name: '', age: '', country: 'Canada', region: '',
    user_type: 'individual', household_type: 'single', business_owner: false,
  });

  const [snapshot, setSnapshot] = useState<SnapshotData>({
    monthly_income: '', monthly_expenses: '', monthly_savings: '',
    total_savings: '', total_investments: '', total_debt: '',
    credit_score: '', emergency_fund: '', monthly_debt_payments: '',
  });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('financial_snapshots').select('*').eq('user_id', user.id)
          .order('updated_at', { ascending: false }).limit(1).single(),
      ]);

      if (p) {
        setProfile({
          first_name: p.first_name ?? '',
          age: p.age ? String(p.age) : '',
          country: p.country ?? 'Canada',
          region: p.region ?? '',
          user_type: p.user_type ?? 'individual',
          household_type: p.household_type ?? 'single',
          business_owner: p.business_owner ?? false,
        });
      }

      if (s) {
        setSnapshot({
          monthly_income:       String(s.monthly_income ?? ''),
          monthly_expenses:     String(s.monthly_expenses ?? ''),
          monthly_savings:      String(s.monthly_savings ?? ''),
          total_savings:        String(s.total_savings ?? ''),
          total_investments:    String(s.total_investments ?? ''),
          total_debt:           String(s.total_debt ?? ''),
          credit_score:         String(s.credit_score ?? ''),
          emergency_fund:       String(s.emergency_fund ?? ''),
          monthly_debt_payments:String(s.monthly_debt_payments ?? ''),
        });
      }

      setLoading(false);
    })();
  }, []);

  function setP(k: keyof ProfileData, v: unknown) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  function setS(k: keyof SnapshotData, v: string) {
    setSnapshot((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const n = (v: string) => parseFloat(v) || 0;

      await supabase.from('profiles').upsert({
        id: user.id,
        first_name: profile.first_name || null,
        age: profile.age ? parseInt(profile.age) : null,
        country: profile.country,
        region: profile.region || null,
        user_type: profile.user_type,
        household_type: profile.household_type,
        business_owner: profile.business_owner,
        updated_at: new Date().toISOString(),
      });

      await supabase.from('financial_snapshots').upsert({
        user_id: user.id,
        monthly_income:        n(snapshot.monthly_income),
        monthly_expenses:      n(snapshot.monthly_expenses),
        monthly_savings:       n(snapshot.monthly_savings),
        total_savings:         n(snapshot.total_savings),
        total_investments:     n(snapshot.total_investments),
        total_debt:            n(snapshot.total_debt),
        credit_score:          n(snapshot.credit_score),
        emergency_fund:        n(snapshot.emergency_fund),
        monthly_debt_payments: n(snapshot.monthly_debt_payments),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      // Record score history snapshot
      try {
        const { calcAllMetrics } = await import('@/lib/command/calculations');
        const snapshotObj = Object.fromEntries(
          Object.entries(snapshot).map(([k, v]) => [k, parseFloat(v) || 0])
        );
        const metrics = calcAllMetrics(snapshotObj as any, parseInt(profile.age) || undefined);
        if (metrics.health_score > 0) {
          await supabase.from('score_history').insert({
            user_id: user.id,
            score: metrics.health_score,
            health_label: metrics.health_label,
          });
        }
      } catch {}

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-4">
        {[1,2,3,4].map(i => <div key={i} className="glass-card h-14 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold text-white">Edit Profile</h1>
        <p className="mt-0.5 text-sm text-zinc-400">Update your financial data to keep your health score accurate.</p>
      </div>

      {/* Tabs */}
      <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
        {(['identity', 'finances'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {t === 'identity' ? 'Identity' : 'Finances'}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <div className="glass-card p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">First Name</label>
              <input className="cmd-input w-full" placeholder="Alex" value={profile.first_name} onChange={(e) => setP('first_name', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Age</label>
              <input className="cmd-input w-full" type="number" min="16" max="100" placeholder="32" value={profile.age} onChange={(e) => setP('age', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Country</label>
              <select className="cmd-select w-full" value={profile.country} onChange={(e) => setP('country', e.target.value)}>
                <option>Canada</option>
                <option>United States</option>
                <option>United Kingdom</option>
                <option>Australia</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Province / State</label>
              <input className="cmd-input w-full" placeholder="Ontario" value={profile.region} onChange={(e) => setP('region', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">I am a…</label>
              <select className="cmd-select w-full" value={profile.user_type} onChange={(e) => setP('user_type', e.target.value)}>
                {USER_TYPES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Household Type</label>
              <select className="cmd-select w-full" value={profile.household_type} onChange={(e) => setP('household_type', e.target.value)}>
                <option value="single">Single</option>
                <option value="couple">Couple</option>
                <option value="family">Family</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input type="checkbox" id="biz" checked={profile.business_owner} onChange={(e) => setP('business_owner', e.target.checked)} className="accent-brand-green" />
              <label htmlFor="biz" className="text-sm text-zinc-400 cursor-pointer">I own or operate a business</label>
            </div>
          </div>
        </div>
      )}

      {tab === 'finances' && (
        <div className="glass-card p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { key: 'monthly_income',        label: 'Monthly Income ($)',         placeholder: '5000' },
              { key: 'monthly_expenses',       label: 'Monthly Expenses ($)',        placeholder: '3200' },
              { key: 'monthly_savings',        label: 'Monthly Savings ($)',         placeholder: '800' },
              { key: 'monthly_debt_payments',  label: 'Monthly Debt Payments ($)',   placeholder: '400' },
              { key: 'total_savings',          label: 'Total Savings ($)',           placeholder: '12000' },
              { key: 'total_investments',      label: 'Total Investments ($)',       placeholder: '30000' },
              { key: 'total_debt',             label: 'Total Debt Owed ($)',         placeholder: '18000' },
              { key: 'emergency_fund',         label: 'Emergency Fund ($)',          placeholder: '5000' },
              { key: 'credit_score',           label: 'Credit Score',               placeholder: '720' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="mb-1 block text-xs text-zinc-400">{label}</label>
                <input
                  className="cmd-input w-full"
                  type="number"
                  min="0"
                  placeholder={placeholder}
                  value={snapshot[key as keyof SnapshotData]}
                  onChange={(e) => setS(key as keyof SnapshotData, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          className="cmd-btn-primary px-8 py-2.5 text-sm"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saved && (
          <span className="text-sm text-brand-green font-medium">✓ Saved — your score has been updated.</span>
        )}
      </div>

      <LegalDisclaimer />
    </div>
  );
}

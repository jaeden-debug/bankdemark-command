'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ProUpgradeCard from './ProUpgradeCard';
import LegalDisclaimer from './LegalDisclaimer';

type GoalType = 'emergency_fund' | 'debt_payoff' | 'savings' | 'investment' | 'custom';

interface Goal {
  id: string;
  title: string;
  type: GoalType;
  target: number;
  current: number;
  target_date?: string | null;
  notes?: string | null;
  completed: boolean;
}

const GOAL_TYPE_META: Record<GoalType, { label: string; icon: string; color: string }> = {
  emergency_fund: { label: 'Emergency Fund',  icon: '🛡',  color: '#00D084' },
  debt_payoff:    { label: 'Debt Payoff',      icon: '⛓',  color: '#F87171' },
  savings:        { label: 'Savings Target',   icon: '💰',  color: '#F5C842' },
  investment:     { label: 'Investment Goal',  icon: '📈',  color: '#3B82F6' },
  custom:         { label: 'Custom Goal',      icon: '✦',  color: '#A78BFA' },
};

const EMPTY: Omit<Goal, 'id' | 'completed'> = {
  title: '',
  type: 'savings',
  target: 0,
  current: 0,
  target_date: '',
  notes: '',
};

function ProgressBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}60` }}
      />
    </div>
  );
}

function GoalCard({ goal, onEdit, onDelete }: { goal: Goal; onEdit: (g: Goal) => void; onDelete: (id: string) => void }) {
  const meta = GOAL_TYPE_META[goal.type];
  const pct = goal.target > 0 ? (goal.current / goal.target) * 100 : 0;
  const remaining = Math.max(0, goal.target - goal.current);
  const fmt = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div
      className={`glass-card p-5 transition-all ${goal.completed ? 'opacity-60' : ''}`}
      style={{ borderColor: goal.completed ? 'rgba(255,255,255,0.08)' : `${meta.color}25` }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <p className="text-sm font-semibold text-white leading-tight">{goal.title}</p>
            <p className="text-xs text-zinc-500">{meta.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {goal.completed && (
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-medium">Done</span>
          )}
          <button onClick={() => onEdit(goal)} className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded">Edit</button>
          <button onClick={() => onDelete(goal.id)} className="text-zinc-600 hover:text-red-400 text-xs px-2 py-1 rounded">×</button>
        </div>
      </div>

      <ProgressBar value={pct} color={meta.color} />

      <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
        <span style={{ color: meta.color }} className="font-semibold">{fmt(goal.current)} saved</span>
        <span>{Math.round(pct)}% of {fmt(goal.target)}</span>
      </div>

      {remaining > 0 && !goal.completed && (
        <p className="mt-1 text-xs text-zinc-500">{fmt(remaining)} remaining</p>
      )}

      {goal.target_date && (
        <p className="mt-1 text-xs text-zinc-600">
          Target: {new Date(goal.target_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
        </p>
      )}
    </div>
  );
}

function GoalForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: Omit<Goal, 'id' | 'completed'> & { id?: string; completed?: boolean };
  onSave: (data: typeof initial) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="glass-card p-5 border-brand-green/20">
      <h3 className="mb-4 text-sm font-semibold text-white">{initial.id ? 'Edit Goal' : 'New Goal'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-zinc-400">Goal Title</label>
          <input className="cmd-input w-full" placeholder="e.g. Emergency fund" value={form.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Type</label>
          <select className="cmd-select w-full" value={form.type} onChange={(e) => set('type', e.target.value as GoalType)}>
            {(Object.keys(GOAL_TYPE_META) as GoalType[]).map((t) => (
              <option key={t} value={t}>{GOAL_TYPE_META[t].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Target ($)</label>
          <input className="cmd-input w-full" type="number" min="0" placeholder="10000" value={form.target || ''} onChange={(e) => set('target', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Current Amount ($)</label>
          <input className="cmd-input w-full" type="number" min="0" placeholder="2500" value={form.current || ''} onChange={(e) => set('current', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Target Date (optional)</label>
          <input className="cmd-input w-full" type="date" value={form.target_date ?? ''} onChange={(e) => set('target_date', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-zinc-400">Notes (optional)</label>
          <input className="cmd-input w-full" placeholder="Any notes about this goal" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {initial.id && (
          <div className="sm:col-span-2 flex items-center gap-2">
            <input type="checkbox" id="completed" checked={form.completed ?? false} onChange={(e) => set('completed', e.target.checked)} className="accent-brand-green" />
            <label htmlFor="completed" className="text-xs text-zinc-400 cursor-pointer">Mark as completed</label>
          </div>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="cmd-btn-primary flex-1 py-2 text-sm" onClick={() => onSave(form)} disabled={saving || !form.title || form.target <= 0}>
          {saving ? 'Saving…' : 'Save Goal'}
        </button>
        <button className="cmd-btn-ghost py-2 text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function GoalsPanel() {
  const supabase = createClient();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(Omit<Goal, 'id' | 'completed'> & { id?: string; completed?: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGoals();
  }, []);

  async function loadGoals() {
    setLoading(true);
    const { data } = await supabase.from('goals').select('*').order('created_at', { ascending: false });
    setGoals(data ?? []);
    setLoading(false);
  }

  async function saveGoal(form: typeof EMPTY & { id?: string; completed?: boolean }) {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        user_id: user.id,
        title: form.title,
        type: form.type,
        target: form.target,
        current: form.current,
        target_date: form.target_date || null,
        notes: form.notes || null,
        completed: form.completed ?? false,
      };

      if (form.id) {
        await supabase.from('goals').update(payload).eq('id', form.id);
      } else {
        await supabase.from('goals').insert(payload);
      }

      setEditing(null);
      await loadGoals();
    } finally {
      setSaving(false);
    }
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal?')) return;
    await supabase.from('goals').delete().eq('id', id);
    setGoals((g) => g.filter((x) => x.id !== id));
  }

  const active = goals.filter((g) => !g.completed);
  const done   = goals.filter((g) => g.completed);

  const totalTarget  = active.reduce((s, g) => s + g.target,  0);
  const totalSaved   = active.reduce((s, g) => s + g.current, 0);
  const overallPct   = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;
  const fmt = (n: number) => `$${n.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Goals</h1>
          <p className="mt-0.5 text-sm text-zinc-400">Track your financial milestones and stay on course.</p>
        </div>
        <button
          className="cmd-btn-primary text-sm px-4 py-2"
          onClick={() => setEditing({ ...EMPTY })}
        >
          + Add Goal
        </button>
      </div>

      {/* Summary strip */}
      {active.length > 0 && (
        <div className="glass-card p-4 border-brand-green/15">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Overall Progress</p>
            <p className="text-sm font-bold text-white">{Math.round(overallPct)}%</p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full transition-all duration-700 bg-brand-green"
              style={{ width: `${overallPct}%`, boxShadow: '0 0 8px #00D08460' }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
            <span className="text-brand-green font-semibold">{fmt(totalSaved)} saved</span>
            <span>of {fmt(totalTarget)} total target</span>
          </div>
        </div>
      )}

      {/* New/Edit form */}
      {editing && (
        <GoalForm
          initial={editing}
          onSave={saveGoal}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}

      {/* Active goals */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="glass-card h-28 animate-pulse" />)}
        </div>
      ) : active.length === 0 && !editing ? (
        <div className="glass-card p-10 text-center">
          <p className="text-3xl mb-3">🎯</p>
          <p className="text-sm font-semibold text-white">No goals yet</p>
          <p className="mt-1 text-xs text-zinc-500 mb-4">Add your first goal — emergency fund, debt payoff, savings target, or anything else.</p>
          <button className="cmd-btn-primary text-sm px-5 py-2" onClick={() => setEditing({ ...EMPTY })}>
            Add Your First Goal
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={(g) => setEditing(g)} onDelete={deleteGoal} />
          ))}
        </div>
      )}

      {/* Completed goals */}
      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Completed</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {done.map((g) => (
              <GoalCard key={g.id} goal={g} onEdit={(g) => setEditing(g)} onDelete={deleteGoal} />
            ))}
          </div>
        </section>
      )}

      <ProUpgradeCard inline />
      <LegalDisclaimer />
    </div>
  );
}

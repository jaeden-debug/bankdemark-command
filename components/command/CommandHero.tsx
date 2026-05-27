'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const STATS = [
  { value: '8 Modules', label: 'Financial tools in one place' },
  { value: '100-pt Score', label: 'Real financial health rating' },
  { value: 'AI Coach', label: 'Context-aware guidance' },
  { value: 'Free to Start', label: 'No credit card required' },
];

const FEATURES = [
  { icon: '⬡', title: 'Financial Health Score', desc: 'One clear number that tells you exactly where you stand.' },
  { icon: '⊗', title: 'Debt Engine', desc: 'Avalanche & snowball payoff strategies with exact timelines.' },
  { icon: '◈', title: 'Wealth Engine', desc: 'Investment projections, FIRE number, and passive income roadmap.' },
  { icon: '◎', title: 'Affordability Engine', desc: 'Know if you can truly afford any purchase before you commit.' },
  { icon: '✦', title: 'AI Coach', desc: 'Ask anything. Get personalized, profile-aware financial guidance.' },
  { icon: '⊟', title: 'Reports', desc: 'Monthly wealth, debt freedom, and health summary reports.' },
];

interface CommandHeroProps {
  onAuthRequest: (mode: 'sign_in' | 'sign_up') => void;
}

export default function CommandHero({ onAuthRequest }: CommandHeroProps) {
  return (
    <div className="min-h-screen bg-surface-950 bg-hero-mesh">
      {/* Top nav */}
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-green to-brand-blue flex items-center justify-center text-white font-bold text-sm">
            B
          </div>
          <span className="font-bold text-white">BankDeMark</span>
          <span className="text-zinc-600 text-sm hidden sm:block">/ Command</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onAuthRequest('sign_in')}
            className="cmd-btn-ghost text-sm"
          >
            Sign In
          </button>
          <button
            onClick={() => onAuthRequest('sign_up')}
            className="cmd-btn-primary text-sm px-4 py-2"
          >
            Start Free
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-green/10 border border-brand-green/20 text-brand-green text-xs font-semibold mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse" />
          Your Complete Financial Control Center
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight tracking-tight mb-6">
          Finally understand
          <br />
          <span className="bg-gradient-to-r from-brand-green via-brand-blue to-brand-gold bg-clip-text text-transparent">
            your money.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          BankDeMark Command is a premium financial intelligence platform — not a basic calculator.
          Calculate your real financial health, escape debt, build wealth, and get AI-powered guidance.
          All in one command center.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
          <button
            onClick={() => onAuthRequest('sign_up')}
            className="cmd-btn-primary text-base px-8 py-4 w-full sm:w-auto"
          >
            Start for Free — No Card Required
          </button>
          <button
            onClick={() => onAuthRequest('sign_in')}
            className="cmd-btn-secondary text-base px-8 py-4 w-full sm:w-auto"
          >
            Sign In to Dashboard
          </button>
        </div>

        <p className="text-xs text-zinc-600">
          Educational financial planning software. Not financial advice.{' '}
          <a href="#disclaimer" className="underline hover:text-zinc-500">Disclaimer ↓</a>
        </p>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-16 max-w-3xl mx-auto">
          {STATS.map(stat => (
            <div key={stat.value} className="glass-card p-4 text-center">
              <div className="text-lg font-bold text-white mb-0.5">{stat.value}</div>
              <div className="text-xs text-zinc-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-bold text-white text-center mb-3">
          Every financial tool you need, in one place
        </h2>
        <p className="text-zinc-500 text-center mb-10 text-sm">
          BankDeMark Command replaces 6 different apps with one premium dashboard.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="glass-card p-5 hover:border-white/14 transition-all group">
              <div className="text-2xl mb-3 text-brand-green group-hover:scale-110 transition-transform inline-block">
                {f.icon}
              </div>
              <h3 className="font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="glass-card p-8 sm:p-12 text-center bg-gradient-to-br from-brand-green/5 to-brand-blue/5 border-brand-green/15">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Ready to take control of your money?
          </h2>
          <p className="text-zinc-400 mb-8 max-w-xl mx-auto">
            Complete your financial profile in 5 minutes and get your personalized Financial Health Score instantly.
          </p>
          <button
            onClick={() => onAuthRequest('sign_up')}
            className="cmd-btn-primary text-base px-10 py-4"
          >
            Get Your Financial Health Score Free
          </button>
        </div>
      </section>

      {/* Disclaimer */}
      <div className="max-w-5xl mx-auto px-6 pb-16" id="disclaimer">
        <div className="p-4 rounded-xl border border-white/5 bg-white/[0.015] text-xs text-zinc-600 leading-relaxed">
          <p className="font-semibold text-zinc-500 mb-1 uppercase tracking-wide text-[10px]">Legal Disclaimer</p>
          <p>
            BankDeMark Command provides educational financial planning tools and estimates based on the information you enter. It is not financial, investment, legal, tax, mortgage, insurance, or credit advice. BankDeMark is not a bank, lender, broker, investment advisor, or credit bureau. Calculations are estimates only and may not reflect your exact financial situation. Always verify important financial decisions with a qualified professional.
          </p>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import ProUpgradeCard from './ProUpgradeCard';
import LegalDisclaimer from './LegalDisclaimer';

const SITE = 'https://bankdemark.com';

const BLOG_LINKS = [
  { title: 'Personal Finance for Beginners', href: `${SITE}/blog/personal-finance-for-beginners`, desc: 'Start with the core money principles before using advanced tools.' },
  { title: 'How To Budget Money', href: `${SITE}/blog/how-to-budget-money`, desc: 'Build a monthly cash-flow system that connects directly to your dashboard.' },
  { title: 'How To Save Money & Build an Emergency Fund', href: `${SITE}/blog/how-to-save-money-emergency-fund`, desc: 'Protect your finances before debt, business, or investing pressure hits.' },
  { title: 'How To Build Credit', href: `${SITE}/blog/how-to-build-credit`, desc: 'Understand credit-building habits before applying for cards, loans, or business products.' },
  { title: 'How Compound Interest Works', href: `${SITE}/blog/how-compound-interest-works`, desc: 'Learn the wealth engine behind investing, FIRE, and long-term projections.' },
  { title: 'How To Start Investing', href: `${SITE}/blog/how-to-start-investing`, desc: 'Begin investing with simple, long-term strategy before chasing returns.' },
  { title: 'Index Funds vs ETFs', href: `${SITE}/blog/index-funds-vs-etfs`, desc: 'Compare two of the most common beginner-friendly investing vehicles.' },
  { title: 'How To Build Business Credit', href: `${SITE}/blog/how-to-build-business-credit`, desc: 'Separate business and personal finances while building business credibility.' },
  { title: 'Best Business Credit Cards for a New Business', href: `${SITE}/blog/best-business-credit-cards-new-business`, desc: 'Learn how business credit cards can support cash flow and tracking.' },
  { title: 'Financial Freedom Roadmap', href: `${SITE}/blog/financial-freedom-roadmap`, desc: 'Connect budgeting, debt payoff, investing, and business income into one plan.' },
  { title: 'AI Finance Tools', href: `${SITE}/blog/ai-finance-tools`, desc: 'See how AI tools can support smarter financial planning and automation.' },
  { title: 'How Long To Reach $1 Million Investing', href: `${SITE}/blog/how-long-to-reach-1-million-investing`, desc: 'Understand the math behind long-term wealth targets.' },
];

const CALCULATOR_LINKS = [
  { title: 'Budget Calculator', href: `${SITE}/calculators/budget-calculator`, desc: 'Plan income, expenses, and monthly cash flow.' },
  { title: 'Emergency Fund Calculator', href: `${SITE}/calculators/emergency-fund-calculator`, desc: 'Calculate your safety buffer and emergency runway.' },
  { title: 'Debt Payoff Calculator', href: `${SITE}/calculators/debt-payoff-calculator`, desc: 'Compare payoff timelines and debt attack strategies.' },
  { title: 'Credit Card Payoff Calculator', href: `${SITE}/calculators/credit-card-payoff-calculator`, desc: 'Estimate payoff speed and interest savings.' },
  { title: 'Net Worth Calculator', href: `${SITE}/calculators/net-worth-calculator`, desc: 'Track assets, liabilities, and financial progress.' },
  { title: 'Compound Interest Calculator', href: `${SITE}/calculators/compound-interest-calculator`, desc: 'Project growth from contributions and time.' },
  { title: 'Investment Calculator', href: `${SITE}/calculators/investment-calculator`, desc: 'Model long-term investing scenarios.' },
  { title: 'FIRE Calculator', href: `${SITE}/calculators/fire-calculator`, desc: 'Estimate your financial independence number.' },
  { title: 'Retirement Calculator', href: `${SITE}/calculators/retirement-calculator`, desc: 'Plan retirement income and contribution needs.' },
  { title: 'TFSA Calculator', href: `${SITE}/calculators/tfsa-calculator`, desc: 'Estimate tax-free account growth.' },
  { title: 'RRSP Calculator', href: `${SITE}/calculators/rrsp-calculator`, desc: 'Estimate retirement savings and contribution impact.' },
  { title: 'Mortgage Calculator', href: `${SITE}/calculators/mortgage-calculator`, desc: 'Estimate payment, interest, and affordability.' },
  { title: 'Rent vs Buy Calculator', href: `${SITE}/calculators/rent-vs-buy-calculator`, desc: 'Compare renting and home ownership scenarios.' },
];

const PILLAR_LINKS = [
  { title: 'Personal Finance Hub', href: `${SITE}/pillars/personal-finance`, desc: 'Budgeting, saving, credit, and financial basics.' },
  { title: 'Investing Hub', href: `${SITE}/pillars/investing`, desc: 'Compound growth, ETFs, index funds, and long-term investing.' },
  { title: 'Business Credit Hub', href: `${SITE}/pillars/business-credit`, desc: 'Business banking, credit building, and founder finance systems.' },
  { title: 'Debt Management Hub', href: `${SITE}/pillars/debt-management`, desc: 'Debt payoff, consolidation, credit cards, and interest strategy.' },
  { title: 'Financial Freedom Hub', href: `${SITE}/pillars/financial-freedom`, desc: 'FIRE, passive income, retirement planning, and wealth systems.' },
  { title: 'Banking Hub', href: `${SITE}/pillars/banking`, desc: 'Accounts, cash management, banking tools, and financial products.' },
];

const FOOTER_LINKS = [
  { title: 'Home', href: SITE },
  { title: 'About', href: `${SITE}/about` },
  { title: 'Blog', href: `${SITE}/blog` },
  { title: 'Calculators', href: `${SITE}/calculators` },
  { title: 'Pillars', href: `${SITE}/pillars` },
  { title: 'Money Health Score', href: `${SITE}/money-health-score` },
  { title: 'Financial Freedom Quiz', href: `${SITE}/financial-freedom-quiz` },
  { title: 'Roadmap', href: `${SITE}/financial-freedom-roadmap` },
  { title: 'Contact', href: `${SITE}/contact` },
  { title: 'Privacy', href: `${SITE}/privacy` },
  { title: 'Terms', href: `${SITE}/terms` },
  { title: 'Disclaimer', href: `${SITE}/disclaimer` },
];

function LinkCard({ title, href, desc }: { title: string; href: string; desc: string }) {
  return (
    <a href={href} className="glass-card p-4 transition-all hover:border-brand-green/30 group">
      <div className="text-sm font-semibold text-white group-hover:text-brand-green">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{desc}</p>
      <span className="mt-3 inline-block text-xs font-semibold text-brand-green">Open resource →</span>
    </a>
  );
}

function EmailCapture() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch('/api/email-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    setLoading(false);

    if (res.ok) {
      setDone(true);
      setEmail('');
    } else {
      alert('Could not save email.');
    }
  }

  if (done) {
    return (
      <div className="glass-card border-brand-green/20 bg-brand-green/5 p-6 text-center">
        <p className="font-semibold text-white">You're in.</p>
        <p className="mt-1 text-sm text-zinc-400">Your email was saved locally in data/email-leads.jsonl.</p>
      </div>
    );
  }

  return (
    <div className="glass-card border-brand-blue/20 bg-gradient-to-br from-brand-blue/8 to-brand-green/5 p-6">
      <h2 className="font-bold text-white">Get the BankDeMark Financial Newsletter</h2>
      <p className="mb-4 mt-1 text-sm text-zinc-400">
        Financial tools, calculator updates, app features, and new money guides.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          className="cmd-input flex-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
        />
        <button type="submit" className="cmd-btn-primary px-4" disabled={loading}>
          {loading ? 'Saving…' : 'Subscribe'}
        </button>
      </form>

      <p className="mt-2 text-xs text-zinc-400">Saved locally for now. Connect to email software later.</p>
    </div>
  );
}

export default function Marketplace() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 lg:p-6">
      <section>
        <h1 className="text-xl font-bold text-white">BankDeMark Marketplace</h1>
        <p className="mt-1 text-sm text-zinc-400">
          A monster link hub connecting BankDeMark Command with the public SEO site, calculators, blogs, pillar pages, and conversion funnels.
        </p>
      </section>

      <ProUpgradeCard />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          BankDeMark Authority Blog Library
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BLOG_LINKS.map((link) => (
            <LinkCard key={link.href} {...link} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Free Financial Calculators
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CALCULATOR_LINKS.map((link) => (
            <LinkCard key={link.href} {...link} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Pillar Pages
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLAR_LINKS.map((link) => (
            <LinkCard key={link.href} {...link} />
          ))}
        </div>
      </section>

      <EmailCapture />

      <footer className="glass-card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          BankDeMark Site Links
        </h2>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {FOOTER_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm text-zinc-300 hover:text-brand-green">
              {link.title} →
            </a>
          ))}
        </div>
      </footer>

      <LegalDisclaimer />
    </div>
  );
}

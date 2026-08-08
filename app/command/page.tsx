import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverDb } from '@/lib/services/context';
import HomeNav from '@/components/bdm/HomeNav';
import DemoDashboard from '@/components/bdm/DemoDashboard';

export const dynamic = 'force-dynamic';

const SITE = 'https://command.bankdemark.com';

export const metadata: Metadata = {
  title: { absolute: 'BankDeMark Command | AI Financial Command Center for Business' },
  description:
    'Track revenue, expenses, commissions, cash flow and business wealth in one AI-powered financial command center, with Zylx built in to explain your numbers.',
  // The old canonical pointed at bankdemark.com/command, which returns 404.
  alternates: { canonical: `${SITE}/command` },
  openGraph: {
    type: 'website',
    url: `${SITE}/command`,
    siteName: 'BankDeMark Command',
    title: 'BankDeMark Command | AI Financial Command Center for Business',
    description:
      'See what your business actually earned, where the money went, and what needs attention. Ask Zylx in plain language.',
    images: [{ url: '/command-bankdemark-financial-intelligence-dashboard-og-image.png', width: 1200, height: 630, alt: 'BankDeMark Command dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BankDeMark Command | AI Financial Command Center for Business',
    description: 'Revenue, expenses, cash flow and commissions in one place — with Zylx to explain them.',
    images: ['/command-bankdemark-square-social-preview.png'],
  },
  robots: { index: true, follow: true },
};

// ── Feature truth ───────────────────────────────────────────
// Nothing appears on this page unless it is LIVE in the product.
// Anything unfinished is rendered under an explicit "Not yet"
// heading. The 2026-08-07 audit found eight advertised features
// that were never built; this structure is the guard against that.

const LIVE_MODULES = [
  {
    title: 'Track money in',
    body: 'Record sales, service income and commissions. If you sell a $6,000 trip and earn $600, BankDeMark reports $6,000 booked and $600 earned — not $6,000 of revenue.',
  },
  {
    title: 'Track money out',
    body: 'Expenses, software, advertising, contractors and fees, categorised the way a business owner thinks about them.',
  },
  {
    title: 'Move money safely',
    body: 'Transfers between your own accounts are recorded as a matched pair, so moving $1,000 never becomes $1,000 of revenue and paying a credit card never double-counts the expense.',
  },
  {
    title: 'See what you actually made',
    body: 'Cash on hand, money in, money out, profit and margin — with last period beside it so you can see what changed.',
  },
  {
    title: 'Know what needs attention',
    body: 'Uncategorised transactions, half-recorded transfers and outstanding commissions surface at the top, before the charts.',
  },
  {
    title: 'Keep separate books',
    body: 'Run more than one business from one login. Each keeps its own books. Nothing mixes.',
  },
  {
    title: 'Snap a receipt',
    body: 'Photograph a receipt and we read the merchant, date and total, then check whether it is already in your books before adding anything. You confirm every figure — nothing is recorded on a guess.',
  },
  {
    title: 'Generate a P&L',
    body: 'One click for what came in, what went out and what you actually made — with the movements that are not profit listed separately, so it is clear why it does not match your bank balance.',
  },
  {
    title: 'Import from your bank',
    body: 'Drop in a CSV export. We work out which columns are which, skip anything you already have, and show you exactly what will land before it does.',
  },
];

const NOT_YET = [
  'Live bank, Stripe, Shopify and PayPal connections',
  'Cash flow, balance sheet and tax reports',
  'Tax readiness checks and accountant package',
  'Personal net worth, investments and retirement',
  'Zylx web research and Zylx Studio business context',
];

const ZYLX_QUESTIONS = [
  'How much did I actually make last month?',
  'Why is cash down if revenue is up?',
  'How much commission am I still owed?',
  'What did I spend the most on?',
  'What needs my attention?',
  'Log $82.54 on Facebook ads yesterday.',
];

const FAQ = [
  {
    q: 'What is BankDeMark Command?',
    a: 'Software that keeps the books for a small business and explains them. You record what money came in and went out, and BankDeMark works out what you actually earned, what you spent, what you are owed and what needs attention.',
  },
  {
    q: 'Is BankDeMark accounting software?',
    a: 'It keeps accurate books using proper accounting semantics underneath, but it is built for the business owner rather than for an accountant. It does not file anything and it is not a substitute for a qualified accountant.',
  },
  {
    q: 'What is Zylx?',
    a: 'Zylx is the AI assistant built into BankDeMark Command. It reads your recorded financial data and explains it in plain language. Zylx does not calculate your figures itself — the backend computes them and Zylx explains the result, so the numbers it quotes are the same ones on your dashboard.',
  },
  {
    q: 'Can Zylx change my records?',
    a: 'Only with your approval. If you ask Zylx to log an expense, it prepares the entry and shows you a card to confirm. Nothing is written to your books until you press approve, and every change records that Zylx originated it.',
  },
  {
    q: 'Does BankDeMark connect to my bank?',
    a: 'Not with a live connection yet. You can import a CSV export from your bank, which handles most of the work, and you can record transactions by hand. Automatic bank, Stripe, Shopify and PayPal connections are being built.',
  },
  {
    q: 'Can Zylx read my receipts?',
    a: 'Yes. Photograph a receipt and BankDeMark reads the merchant, date and total, suggests a category, and checks whether it already matches a transaction you have. Every figure is shown in an editable form for you to confirm — an AI reading of someone else\'s document never becomes a financial record on its own, and the record keeps a note of how it was read.',
  },
  {
    q: 'Can I track commissions?',
    a: 'Yes. BankDeMark keeps the sale value and the amount you earned as separate figures, so booking volume and recognised revenue never get confused.',
  },
  {
    q: 'Can I run more than one business?',
    a: 'Yes. Each business keeps completely separate books. A combined view groups them by currency without merging any records.',
  },
  {
    q: 'Is BankDeMark financial advice?',
    a: 'No. BankDeMark provides financial organisation, calculation and reporting software. It does not provide financial, tax, legal, investment, lending or accounting advice.',
  },
];

export default async function CommandHomePage() {
  // Signed-in visitors go straight to their businesses.
  try {
    const db = serverDb();
    const { data } = await db.auth.getUser();
    if (data.user) redirect('/command/portfolio');
  } catch {
    // Not signed in, or Supabase env missing locally — render the page.
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://bankdemark.com/#organization',
        name: 'BankDeMark',
        url: 'https://bankdemark.com',
        logo: 'https://bankdemark.com/icon.png',
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        url: SITE,
        name: 'BankDeMark Command',
        publisher: { '@id': 'https://bankdemark.com/#organization' },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE}/#software`,
        name: 'BankDeMark Command',
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Web',
        url: `${SITE}/command`,
        description:
          'Financial command center for small businesses. Track revenue, expenses, commissions and cash flow, and ask Zylx about the numbers.',
        publisher: { '@id': 'https://bankdemark.com/#organization' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD' },
        featureList: LIVE_MODULES.map((m) => m.title),
      },
      {
        '@type': 'WebPage',
        '@id': `${SITE}/command#webpage`,
        url: `${SITE}/command`,
        name: 'BankDeMark Command | AI Financial Command Center for Business',
        isPartOf: { '@id': `${SITE}/#website` },
        about: { '@id': `${SITE}/#software` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE}/command#faq`,
        mainEntity: FAQ.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <HomeNav />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1120px] px-4 pb-10 pt-10 sm:px-6 lg:pb-14 lg:pt-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="bdm-eyebrow">AI-powered business finance</p>
            <h1 className="mt-3 text-[34px] font-extrabold leading-[1.08] tracking-tight2 text-ink sm:text-[46px] lg:text-[56px]">
              Know exactly where your business money is going.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-lg">
              Track revenue, expenses, commissions and cash flow in one financial command center —
              with Zylx built in to explain your numbers and help you record them.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/auth/sign-in?mode=sign-up" className="bdm-btn-gold w-full px-7 py-3.5 text-base sm:w-auto">
                Build my financial command center
              </Link>
              <Link href="#how" className="bdm-btn-secondary w-full px-7 py-3.5 text-base sm:w-auto">
                See how it works
              </Link>
            </div>
            <p className="mt-3 text-[13px] text-muted">Start free. No credit card required.</p>
          </div>

          <div className="mt-10 lg:mt-14">
            <DemoDashboard />
          </div>
        </section>

        {/* ── VALUE STRIP ──────────────────────────────────── */}
        <section aria-label="What you get" className="border-y border-gold-line bg-white/45">
          <div className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 py-9 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {[
              ['Revenue & profit', 'See what your business actually earns.'],
              ['Expenses & cash flow', 'Know where your money is going.'],
              ['What needs attention', 'Catch problems before they compound.'],
              ['Ask Zylx', 'Understand your finances in plain language.'],
            ].map(([title, body]) => (
              <div key={title}>
                <h2 className="text-sm font-bold text-ink">{title}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── PROBLEM ──────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[820px] px-4 py-14 text-center sm:px-6">
          <h2 className="text-[28px] font-extrabold leading-tight tracking-tight2 text-ink sm:text-[34px]">
            Your bank balance doesn&apos;t tell you how your business is doing.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Money comes in that isn&apos;t revenue. Money goes out that isn&apos;t an expense. A
            transfer between your own accounts looks like income. A credit card payment looks like a
            second cost. By the time you notice, the numbers you have been working from were never
            right.
          </p>
          <p className="mt-4 text-[17px] font-semibold leading-relaxed text-ink">
            BankDeMark keeps the difference straight, so the figures you act on are the real ones.
          </p>
        </section>

        {/* ── CORE MODULES ─────────────────────────────────── */}
        <section id="how" className="mx-auto w-full max-w-[1120px] scroll-mt-20 px-4 py-4 sm:px-6">
          <header className="mx-auto max-w-2xl text-center">
            <h2 className="text-[28px] font-extrabold leading-tight tracking-tight2 text-ink sm:text-[34px]">
              Everything behind your business, in one place.
            </h2>
            <p className="mt-3 text-[15px] text-muted">Everything below works today.</p>
          </header>

          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LIVE_MODULES.map((m) => (
              <article key={m.title} className="bdm-card p-5">
                <h3 className="text-base font-bold text-ink">{m.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{m.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-panel border border-gold-line bg-white/50 p-5">
            <h3 className="text-sm font-bold text-ink">Not yet — being built</h3>
            <p className="mt-1 text-[13px] text-muted">
              Listed so nothing on this page is a promise the product can&apos;t keep.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {NOT_YET.map((item) => (
                <li key={item} className="rounded-pill border border-gold-line bg-white/70 px-3 py-1.5 text-[12px] text-muted">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── ZYLX ─────────────────────────────────────────── */}
        <section id="zylx" className="mt-14 scroll-mt-20 border-y border-gold-line bg-white/45">
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-9 px-4 py-14 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="bdm-eyebrow">Zylx</p>
              <h2 className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight2 text-ink sm:text-[34px]">
                Your financial assistant already knows the numbers.
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-muted">
                Ask about your business finances in plain language. Zylx reads your recorded data and
                explains what happened.
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink">
                Zylx does not do the arithmetic. BankDeMark calculates every figure and Zylx explains
                the result — so what it tells you is the same number on your dashboard, not an
                estimate.
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-muted">
                Ask it to record something and it prepares the entry for you to approve. Nothing is
                written to your books until you confirm.
              </p>
              <Link href="/auth/sign-in?mode=sign-up" className="bdm-btn-primary mt-6">
                Ask Zylx about my business
              </Link>
            </div>

            <ul className="space-y-2">
              {ZYLX_QUESTIONS.map((q) => (
                <li key={q} className="bdm-card px-4 py-3 text-[15px] text-ink">
                  <span aria-hidden className="mr-2 text-gold">✦</span>
                  {q}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── BUSINESS-MODEL INTELLIGENCE ──────────────────── */}
        <section className="mx-auto w-full max-w-[1120px] px-4 py-14 sm:px-6">
          <header className="mx-auto max-w-2xl text-center">
            <h2 className="text-[28px] font-extrabold leading-tight tracking-tight2 text-ink sm:text-[34px]">
              Built to understand the business behind the transaction.
            </h2>
          </header>

          <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
            <div className="bdm-card p-5">
              <p className="bdm-eyebrow">Most tools see</p>
              <p className="bdm-figure-lg mt-2">+$600</p>
              <p className="mt-2 text-[13px] text-muted">A deposit. That&apos;s all.</p>
            </div>
            <div className="bdm-card border-gold/40 p-5">
              <p className="bdm-eyebrow">BankDeMark records</p>
              <dl className="mt-2 space-y-1 text-[13px]">
                {[
                  ['Type', 'Commission earned'],
                  ['Booking value', '$6,000'],
                  ['Recognised revenue', '$600'],
                  ['Still owed', '$0'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted">{k}</dt>
                    <dd className="bdm-num font-bold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <p className="mx-auto mt-5 max-w-2xl text-center text-[15px] leading-relaxed text-muted">
            The same distinction matters for an online store separating gross sales from refunds and
            fees, or an agency separating project income from subcontractor costs.
          </p>
        </section>

        {/* ── TRUST ────────────────────────────────────────── */}
        <section id="security" className="scroll-mt-20 border-y border-gold-line bg-white/45">
          <div className="mx-auto w-full max-w-[1120px] px-4 py-14 sm:px-6">
            <h2 className="text-center text-[28px] font-extrabold tracking-tight2 text-ink sm:text-[34px]">
              Your numbers stay yours.
            </h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Separate books', 'Every business is isolated at the database level. One business can never read another.'],
                ['Deterministic figures', 'Financial totals are computed by the backend, never by the AI.'],
                ['Approval before writes', 'Zylx proposes. You approve. Nothing is recorded otherwise.'],
                ['Every change recorded', 'Who changed what, when, and from which surface — including Zylx.'],
              ].map(([title, body]) => (
                <article key={title} className="bdm-card p-5">
                  <h3 className="text-sm font-bold text-ink">{title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
                </article>
              ))}
            </div>
            <p className="mt-5 text-center text-[13px] text-muted">
              BankDeMark holds no security certification and does not claim one.
            </p>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[820px] px-4 py-14 sm:px-6">
          <h2 className="text-center text-[28px] font-extrabold tracking-tight2 text-ink sm:text-[34px]">
            Questions
          </h2>
          <div className="mt-8 space-y-2">
            {FAQ.map((f) => (
              <details key={f.q} className="bdm-card group p-5">
                <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">
                  <span className="flex items-start justify-between gap-3">
                    {f.q}
                    <span aria-hidden className="mt-0.5 shrink-0 text-muted transition-transform group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── FINAL CTA ────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[820px] px-4 pb-14 text-center sm:px-6">
          <div className="bdm-card p-8 sm:p-10">
            <h2 className="text-[28px] font-extrabold leading-tight tracking-tight2 text-ink sm:text-[36px]">
              Stop guessing what your business is doing.
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[16px] leading-relaxed text-muted">
              See your money clearly. Understand what changed. Know what needs your attention.
            </p>
            <Link href="/auth/sign-in?mode=sign-up" className="bdm-btn-gold mt-7 px-7 py-3.5 text-base">
              Create my command center
            </Link>
            <p className="mt-3 text-[13px] text-muted">Free to start. No credit card required.</p>
          </div>
        </section>

        {/* ── DISCLAIMER / FOOTER ──────────────────────────── */}
        <footer className="border-t border-gold-line">
          <div className="mx-auto w-full max-w-[1120px] px-4 py-9 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Link href="/command" className="text-[17px] font-extrabold tracking-brand">
                <span className="text-ink">Bank</span><span className="text-gold">DeMark</span>
                <span className="ml-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Command</span>
              </Link>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
                <a href="https://bankdemark.com" className="hover:text-ink">BankDeMark</a>
                <a href="https://bankdemark.com/calculators" className="hover:text-ink">Free calculators</a>
                <a href="https://bankdemark.com/blog" className="hover:text-ink">Guides</a>
                <a href="https://bankdemark.com/privacy" className="hover:text-ink">Privacy</a>
                <a href="https://bankdemark.com/terms" className="hover:text-ink">Terms</a>
                <a href="https://bankdemark.com/disclaimer" className="hover:text-ink">Disclaimer</a>
              </nav>
            </div>
            <p className="mt-6 text-[12px] leading-relaxed text-muted">
              BankDeMark provides financial organisation, calculation and reporting software. It does
              not provide financial, tax, legal, investment, lending or accounting advice, and it is
              not a bank, lender, broker, accountant or advisor. Important financial decisions should
              be verified with a qualified professional.{' '}
              <a href="https://bankdemark.com/disclaimer" className="font-semibold text-gold-dark underline">
                Full disclaimer
              </a>
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}

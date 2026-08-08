import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

// Only reports that actually generate appear here. Anything unfinished
// is listed plainly as not ready rather than shown as a dead tile.
const AVAILABLE = [
  {
    href: 'profit-and-loss',
    title: 'Profit & Loss',
    body: 'What came in, what went out, and what you actually made.',
  },
];

const NOT_READY = [
  'Cash flow statement',
  'Balance sheet',
  'Tax summary',
  'Commission report',
  'Accountant package',
];

export default async function ReportsPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'viewer');
  const base = `/b/${ctx.businessId}/reports`;

  return (
    <div className="bdm-page max-w-2xl space-y-5">
      <header>
        <p className="bdm-eyebrow">{ctx.business.name}</p>
        <h1 className="bdm-h1">Reports</h1>
      </header>

      <div className="space-y-2">
        {AVAILABLE.map((r) => (
          <Link key={r.href} href={`${base}/${r.href}`} className="bdm-card-interactive flex items-center justify-between gap-4 p-5">
            <span>
              <span className="block text-[15px] font-bold text-ink">{r.title}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{r.body}</span>
            </span>
            <span aria-hidden className="shrink-0 text-muted">→</span>
          </Link>
        ))}
      </div>

      <div className="rounded-panel border border-gold-line bg-white/50 p-4">
        <h2 className="text-sm font-bold text-ink">Not ready yet</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {NOT_READY.map((r) => (
            <li key={r} className="rounded-pill border border-gold-line bg-white/70 px-3 py-1.5 text-[12px] text-muted">
              {r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

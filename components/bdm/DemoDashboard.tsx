/**
 * Marketing visualisation of the Command dashboard.
 *
 * Server-rendered, no client JS, no chart library. Every figure is
 * clearly labelled as example data — the audit found the previous
 * product showing sample revenue that read as real.
 */
const BARS = [
  { month: 'Feb', inPct: 52, outPct: 38 },
  { month: 'Mar', inPct: 61, outPct: 41 },
  { month: 'Apr', inPct: 48, outPct: 44 },
  { month: 'May', inPct: 72, outPct: 46 },
  { month: 'Jun', inPct: 66, outPct: 52 },
  { month: 'Jul', inPct: 88, outPct: 58 },
];

export default function DemoDashboard() {
  return (
    <figure className="mx-auto w-full max-w-[980px]">
      <div className="bdm-card overflow-hidden p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="bdm-eyebrow">Business overview</p>
            <p className="text-sm font-bold text-ink">This month</p>
          </div>
          <span className="bdm-badge-neutral">Example data</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {[
            ['Cash on hand', '$48,210', null],
            ['Money in', '$22,400', '↑ 14%'],
            ['Money out', '$14,850', '↓ 4%'],
            ['Profit', '$7,550', '33.7% margin'],
          ].map(([label, value, meta]) => (
            <div key={label as string} className="rounded-panel border border-gold-line bg-white/65 p-3.5">
              <p className="bdm-eyebrow">{label}</p>
              <p className="bdm-figure-lg mt-1.5">{value}</p>
              {meta && <p className="mt-1 text-[11px] font-semibold text-muted">{meta}</p>}
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-5">
          <div className="rounded-panel border border-gold-line bg-white/65 p-4 lg:col-span-3">
            <p className="text-[13px] font-bold text-ink">Money in and out</p>
            <div className="mt-4 flex items-end gap-3 sm:gap-4" style={{ height: 120 }} aria-hidden="true">
              {BARS.map((b) => (
                <div key={b.month} className="flex h-full flex-1 flex-col items-center gap-1.5">
                  <div className="flex min-h-0 w-full flex-1 items-end justify-center gap-1">
                    <div className="w-1/2 max-w-[20px] rounded-t bg-ink" style={{ height: `${b.inPct}%` }} />
                    <div className="w-1/2 max-w-[20px] rounded-t bg-gold/60" style={{ height: `${b.outPct}%` }} />
                  </div>
                  <span className="text-[10px] font-semibold text-muted">{b.month}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-panel border border-gold-line bg-white/65 p-4 lg:col-span-2">
            <p className="text-[13px] font-bold text-ink">Needs attention</p>
            <ul className="mt-3 space-y-2 text-[13px]">
              {[
                '18 transactions need a category',
                '2 commissions still outstanding',
                '1 transfer only has one side recorded',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-muted">
                  <span aria-hidden className="mt-0.5 text-caution">•</span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-control border border-gold/40 bg-gold-tint px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-dark">Ask Zylx</p>
              <p className="mt-1 text-[13px] text-ink">&ldquo;Why is cash down if revenue is up?&rdquo;</p>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[12px] text-muted">
        Example figures shown to illustrate the interface. Your dashboard shows only your own data.
      </figcaption>
    </figure>
  );
}

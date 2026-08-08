'use client';

import type { ZylxBlock } from '@/lib/zylx/envelope';

/**
 * Renders the typed blocks Zylx returns.
 *
 * The switch IS the allow-list — an unknown block type falls through to
 * null and renders nothing. There is no path from a string in a model
 * response to a component being mounted.
 */
export default function ZylxBlocks({
  blocks,
  onApprove,
  approving,
  approved,
}: {
  blocks: ZylxBlock[];
  onApprove?: (payload: Record<string, unknown>) => void;
  approving?: boolean;
  approved?: boolean;
}) {
  if (blocks.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'metric':
            return (
              <section key={i} aria-label={block.title ?? 'Figures'}>
                {block.title && <p className="bdm-eyebrow mb-2">{block.title}</p>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {block.figures.map((f) => {
                    const good =
                      f.change == null
                        ? null
                        : f.goodWhen === 'down'
                          ? f.change <= 0
                          : f.change >= 0;
                    return (
                      <div key={f.label} className="rounded-panel border border-gold-line bg-white/65 p-3">
                        <p className="bdm-eyebrow">{f.label}</p>
                        <p className="bdm-figure-lg mt-1">{f.formatted}</p>
                        {f.change != null && (
                          <p className={`mt-0.5 text-[11px] font-bold ${good ? 'text-positive' : 'text-negative'}`}>
                            {f.change >= 0 ? '↑' : '↓'} {Math.abs(f.change * 100).toFixed(0)}%
                          </p>
                        )}
                        {f.hint && <p className="mt-0.5 text-[11px] text-muted">{f.hint}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            );

          case 'table':
            return (
              <section key={i} className="rounded-panel border border-gold-line bg-white/65 p-4">
                {block.title && <p className="mb-2 text-[13px] font-bold text-ink">{block.title}</p>}
                <div className="bdm-scroll-x">
                  <table className="w-full min-w-[320px] text-[13px]">
                    <caption className="sr-only">{block.title ?? 'Results'}</caption>
                    <thead>
                      <tr className="border-b border-gold-line text-left">
                        {block.columns.map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            className={`pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted ${
                              c.align === 'right' ? 'text-right' : ''
                            }`}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r} className="border-b border-gold-line/50 last:border-0">
                          {block.columns.map((c) => (
                            <td
                              key={c.key}
                              className={`py-1.5 ${c.align === 'right' ? 'bdm-num text-right font-semibold' : 'text-ink'}`}
                            >
                              {String(row[c.key] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {block.truncated && (
                  <p className="mt-2 text-[11px] text-muted">
                    Showing {block.truncated.shown} of {block.truncated.total}. The totals above cover
                    all {block.truncated.total}.
                  </p>
                )}
              </section>
            );

          case 'proposal':
            return (
              <section key={i} className="rounded-panel border border-gold/45 bg-gold-tint p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-dark">
                  Needs your approval
                </p>
                <p className="mt-1.5 text-sm font-semibold text-ink">{block.summary}</p>
                {block.warnings.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {block.warnings.map((w) => (
                      <li key={w} className="text-xs text-caution">— {w}</li>
                    ))}
                  </ul>
                )}
                {approved ? (
                  <p className="mt-3 text-sm font-semibold text-positive">✓ Recorded</p>
                ) : (
                  onApprove && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="bdm-btn-gold bdm-btn-sm"
                        disabled={approving}
                        onClick={() => onApprove(block.payload)}
                      >
                        {approving ? 'Recording…' : 'Yes, record it'}
                      </button>
                    </div>
                  )
                )}
              </section>
            );

          case 'source':
            return (
              <p key={i} className="flex items-start gap-2 text-[12px] text-muted">
                <span aria-hidden className="text-caution">⚠</span>
                <span>
                  <strong className="font-semibold text-ink">{block.label}.</strong>{' '}
                  {block.detail}
                  {block.dataThrough && ` Data through ${block.dataThrough}.`}
                </span>
              </p>
            );

          // Reserved types. Schemas exist; renderers do not ship yet, so
          // they render nothing rather than a broken card.
          case 'chart':
          case 'document':
          default:
            return null;
        }
      })}
    </div>
  );
}

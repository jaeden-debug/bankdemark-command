'use client';

export default function LegalDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-xs text-zinc-600 leading-relaxed">
        BankDeMark Command provides educational financial planning tools and estimates. It is not financial, investment, legal, tax, mortgage, insurance, or credit advice. Calculations are estimates only.{' '}
        <a href="#disclaimer" className="underline hover:text-zinc-500 transition-colors">
          Full disclaimer ↓
        </a>
      </p>
    );
  }

  return (
    <div
      id="disclaimer"
      className="mt-12 p-4 rounded-xl border border-white/5 bg-white/[0.02] text-xs text-zinc-600 leading-relaxed"
    >
      <p className="font-semibold text-zinc-500 mb-1 uppercase tracking-wide text-[10px]">
        Legal Disclaimer
      </p>
      <p>
        BankDeMark Command provides educational financial planning tools and estimates based on the information you enter. It is not financial, investment, legal, tax, mortgage, insurance, or credit advice. BankDeMark is not a bank, lender, broker, investment advisor, or credit bureau. Calculations are estimates only and may not reflect your exact financial situation. Always verify important financial decisions with a qualified professional. Past performance is not indicative of future results. All projections are hypothetical and for educational purposes only.
      </p>
    </div>
  );
}

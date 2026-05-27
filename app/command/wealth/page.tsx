import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import WealthEngine from '@/components/command/WealthEngine';

export const metadata: Metadata = {
  title: 'Wealth Engine — FIRE, Investments & Projections | BankDeMark Command',
  description: 'Project your investment growth, calculate your FIRE number, plan your passive income roadmap, and find out how much to invest monthly.',
  robots: { index: false, follow: false },
};

export default function WealthPage() {
  return (
    <CommandShell>
      <WealthEngine />
    </CommandShell>
  );
}

import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import DebtEngine from '@/components/command/DebtEngine';

export const metadata: Metadata = {
  title: 'Debt Engine — Avalanche & Snowball Payoff | BankDeMark Command',
  description: 'Calculate your debt-free date using avalanche or snowball strategies. See total interest saved, payoff timeline, and personalized debt attack plan.',
  robots: { index: false, follow: false },
};

export default function DebtPage() {
  return (
    <CommandShell>
      <DebtEngine />
    </CommandShell>
  );
}

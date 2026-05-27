import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';

export const metadata: Metadata = {
  title: 'BankDeMark Command | Your Complete Financial Control Center',
  description:
    'BankDeMark Command helps you understand your money, calculate financial health, escape debt, build wealth, plan retirement, and get AI-powered financial guidance.',
  keywords: [
    'financial health score', 'personal finance dashboard', 'debt payoff calculator',
    'FIRE number calculator', 'net worth tracker', 'AI financial advisor',
    'emergency fund calculator', 'wealth building', 'financial independence',
    'budget calculator Canada', 'TFSA RRSP calculator',
  ],
  openGraph: {
    title: 'BankDeMark Command | Your Complete Financial Control Center',
    description: 'One premium dashboard to understand, plan, and optimize your entire financial life.',
    type: 'website',
  },
  alternates: { canonical: 'https://bankdemark.com/command' },
};

export default function CommandPage() {
  return (
    <CommandShell requiresAuth={false}>
      {/* CommandShell shows the hero when not authenticated, dashboard redirect when authenticated */}
      <div />
    </CommandShell>
  );
}

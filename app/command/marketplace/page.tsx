import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import Marketplace from '@/components/command/Marketplace';

export const metadata: Metadata = {
  title: 'Financial Tools & Products | BankDeMark Command',
  description: 'Compare the best savings accounts, credit cards, investment platforms, mortgages, and business banking options personalized to your financial profile.',
  robots: { index: false, follow: false },
};

export default function MarketplacePage() {
  return (
    <CommandShell>
      <Marketplace />
    </CommandShell>
  );
}

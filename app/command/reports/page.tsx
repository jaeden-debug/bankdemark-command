import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import ReportsPanel from '@/components/command/ReportsPanel';

export const metadata: Metadata = {
  title: 'Financial Reports | BankDeMark Command',
  description: 'Generate and print your monthly wealth report, debt freedom report, emergency fund report, and full financial health summary.',
  robots: { index: false, follow: false },
};

export default function ReportsPage() {
  return (
    <CommandShell>
      <ReportsPanel />
    </CommandShell>
  );
}

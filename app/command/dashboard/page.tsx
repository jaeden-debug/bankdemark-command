import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import DashboardOverview from '@/components/command/DashboardOverview';

export const metadata: Metadata = {
  title: 'Financial Dashboard | BankDeMark Command',
  description: 'Your complete financial dashboard — health score, cash flow, net worth, debt tracker, and wealth projections in one place.',
  robots: { index: false, follow: false }, // Private user pages
};

export default function DashboardPage() {
  return (
    <CommandShell>
      <DashboardOverview />
    </CommandShell>
  );
}

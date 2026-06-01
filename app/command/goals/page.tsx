import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import GoalsPanel from '@/components/command/GoalsPanel';

export const metadata: Metadata = {
  title: 'Goals | BankDeMark Command',
  robots: { index: false },
};

export default function GoalsPage() {
  return (
    <CommandShell requiresAuth>
      <GoalsPanel />
    </CommandShell>
  );
}

import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import AICoach from '@/components/command/AICoach';

export const metadata: Metadata = {
  title: 'AI Financial Coach | BankDeMark Command',
  description: 'Ask your personal AI financial coach anything — debt strategy, investing, affordability, FIRE planning. Powered by your real financial profile.',
  robots: { index: false, follow: false },
};

export default function CoachPage() {
  return (
    <CommandShell>
      <AICoach />
    </CommandShell>
  );
}

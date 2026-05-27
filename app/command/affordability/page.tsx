import type { Metadata } from 'next';
import CommandShell from '@/components/command/CommandShell';
import AffordabilityEngine from '@/components/command/AffordabilityEngine';

export const metadata: Metadata = {
  title: 'Affordability Engine — Can I Afford This? | BankDeMark Command',
  description: 'Find out if you can truly afford a car, home, vacation, or any purchase. Get an honest verdict based on your real cash flow, debt load, and emergency fund.',
  robots: { index: false, follow: false },
};

export default function AffordabilityPage() {
  return (
    <CommandShell>
      <AffordabilityEngine />
    </CommandShell>
  );
}

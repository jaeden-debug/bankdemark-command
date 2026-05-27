import type { Metadata } from 'next';
import OnboardingForm from '@/components/command/OnboardingForm';

export const metadata: Metadata = {
  title: 'Set Up Your Financial Profile | BankDeMark Command',
  description: 'Complete your financial profile in 5 minutes and get your personalized Financial Health Score instantly.',
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return <OnboardingForm />;
}

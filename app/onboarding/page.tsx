import { redirect } from 'next/navigation';
import Link from 'next/link';
import OnboardingForm from '@/components/bdm/OnboardingForm';
import { requireUser } from '@/lib/services/context';
import { listBusinesses } from '@/lib/services/businesses';
import { ServiceError } from '@/lib/services/errors';

export const dynamic = 'force-dynamic';

// Authenticated setup flow — 307s to sign-in for anyone else.
export const metadata = { robots: { index: false, follow: false } };


export default async function OnboardingPage() {
  let isFirst = true;
  try {
    const auth = await requireUser();
    isFirst = (await listBusinesses(auth)).length === 0;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'unauthenticated') {
      redirect('/auth/sign-in');
    }
    throw error;
  }

  return (
    <div className="bdm-page max-w-2xl">
      <header className="mb-5">
        <Link href="/command" className="text-[19px] font-extrabold tracking-brand">
          <span className="text-ink">Bank</span><span className="text-gold">DeMark</span>
        </Link>
      </header>
      <OnboardingForm isFirst={isFirst} />
    </div>
  );
}

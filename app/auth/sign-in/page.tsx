import Link from 'next/link';
import AuthForm from '@/components/bdm/AuthForm';

export const metadata = {
  title: 'Sign in · BankDeMark Command',
  robots: { index: false, follow: false },
};

export default function SignInPage({ searchParams }: { searchParams: { mode?: string; next?: string } }) {
  const mode = searchParams.mode === 'sign-up' ? 'sign-up' : 'sign-in';

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <header className="mb-6 text-center">
        <Link href="/command" className="text-[22px] font-extrabold tracking-brand">
          <span className="text-ink">Bank</span>
          <span className="text-gold">DeMark</span>
        </Link>
        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Command</p>
      </header>

      <AuthForm initialMode={mode} next={searchParams.next} />

      <p className="mt-5 text-center text-xs leading-relaxed text-muted">
        BankDeMark Command organises your business finances. It is not an accountant, bookkeeper or
        tax preparer.
      </p>
    </div>
  );
}

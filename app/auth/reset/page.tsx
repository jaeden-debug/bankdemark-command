import Link from 'next/link';
import ResetPasswordForm from '@/components/bdm/ResetPasswordForm';

export const metadata = {
  title: 'Set a new password · BankDeMark Command',
  robots: { index: false, follow: false },
};

export default function ResetPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <header className="mb-6 text-center">
        <Link href="/command" className="text-[22px] font-extrabold tracking-brand">
          <span className="text-ink">Bank</span><span className="text-gold">DeMark</span>
        </Link>
        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Command</p>
      </header>
      <ResetPasswordForm />
    </div>
  );
}

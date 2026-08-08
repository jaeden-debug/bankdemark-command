import Link from 'next/link';
import MagicLinkForm from '@/components/bdm/MagicLinkForm';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  link_expired:
    'That sign-in link has expired or was already used. Links work once and last an hour — request a new one below.',
  link_invalid: 'That sign-in link was not valid. Request a new one below.',
};

export default function SignInPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string; signed_out?: string };
}) {
  const error = searchParams.error ? ERRORS[searchParams.error] ?? ERRORS.link_invalid : null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <Link href="/" className="text-[22px] font-extrabold tracking-brand">
            <span className="text-ink">Bank</span>
            <span className="text-gold">DeMark</span>
          </Link>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
            Invoicing
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-panel border border-caution/30 bg-caution-soft p-4">
            <p className="text-sm font-semibold text-caution">{error}</p>
          </div>
        )}

        {searchParams.signed_out && !error && (
          <div role="status" className="mb-4 rounded-panel border border-gold-line bg-white/70 p-4">
            <p className="text-sm font-semibold text-ink">You&rsquo;re signed out.</p>
          </div>
        )}

        <MagicLinkForm next={searchParams.next} />

        <p className="mt-6 text-center text-xs text-muted">
          Create and send professional invoices. Get paid faster.
        </p>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import MagicLinkForm from '@/components/bdm/MagicLinkForm';
import { resolveCommandDestination, safeInternalPath } from '@/lib/services/post-auth';

export const dynamic = 'force-dynamic';

// Sign-in pages are thin, near-identical across the ecosystem, and
// useless as a search result. Kept crawlable-but-noindex rather than
// only disallowed, so the instruction is unambiguous if it is linked.
export const metadata = { robots: { index: false, follow: false } };


const ERRORS: Record<string, string> = {
  link_expired:
    'That sign-in link has expired or was already used. Links work once and last an hour — request a new one below.',
  link_invalid: 'That sign-in link was not valid. Request a new one below.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string; signed_out?: string };
}) {
  const error = searchParams.error ? ERRORS[searchParams.error] ?? ERRORS.link_invalid : null;

  // Already signed in? Go where they belong rather than showing a form
  // they do not need. This matters more here than it looks: the session
  // cookie is scoped to .bankdemark.com, so somebody signed in to
  // Invoice who clicks "Sign in" on the public Command page arrives here
  // already authenticated. Invoice has had this guard; Command did not.
  if (!error) {
    try {
      const destination = await resolveCommandDestination();
      redirect(safeInternalPath(searchParams.next, destination));
    } catch (e) {
      // `redirect` throws by design; only a genuine auth failure means we
      // should actually render the form.
      if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <Link href="/" className="text-[22px] font-extrabold tracking-brand">
            <span className="text-ink">Bank</span>
            <span className="text-gold">DeMark</span>
          </Link>
          {/* The product being entered, not the product this file was
              copied from. One BankDeMark identity signs you in to both
              applications — the label says which one you are opening. */}
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
            Command
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
          One BankDeMark account for Command and Invoice. New here? Entering your
          email creates the account — there is no separate sign-up.
        </p>
      </div>
    </main>
  );
}

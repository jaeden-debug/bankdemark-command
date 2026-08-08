import { createBrowserClient } from '@supabase/ssr';
import { usesEcosystemCookies } from '@/lib/config/cookies';

/**
 * Browser Supabase client.
 *
 * It MUST write its cookies with the same scope the server uses. If the
 * browser writes a host-scoped cookie and the server later refreshes it
 * with a parent-domain cookie, the browser ends up holding two cookies
 * with the same name and sends both — the server can then read the
 * stale one, the token is rejected, and every authenticated write fails
 * with an RLS denial that looks like a permissions bug.
 *
 * Sharing one scope keeps it to a single cookie, and is also what makes
 * the session visible to the other BankDeMark product.
 */
export function createClient() {
  const shared = usesEcosystemCookies();

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    shared
      ? {
          cookieOptions: {
            domain: '.bankdemark.com',
            path: '/',
            sameSite: 'lax',
            secure: true,
          },
        }
      : undefined
  );
}

// ============================================================
// MAGIC-LINK CALLBACK
//
// Exchanges the one-time code for a session server-side and sets the
// cookies. An expired or already-used link lands on a page that says
// so, rather than a blank screen.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ecosystemCookieOptions } from '@/lib/config/cookies';
import { cookies } from 'next/headers';
import { appUrl } from '@/lib/config/app-url';
import { logError, logEvent } from '@/lib/services/errors';
import { resolveCommandDestination, safeInternalPath } from '@/lib/services/post-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  // Held raw until the session exists — resolving a destination needs an
  // authenticated context, and an unsafe value must not survive that far.
  const rawNext = req.nextUrl.searchParams.get('next');

  const fail = (reason: string) =>
    NextResponse.redirect(appUrl(`/auth/sign-in?error=${encodeURIComponent(reason)}`));

  if (!code) return fail('link_invalid');

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (list) =>
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, ecosystemCookieOptions(options as CookieOptions))
            ),
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logError('auth.callback_exchange_failed', error, { route: '/auth/callback' });
      return fail('link_expired');
    }

    logEvent('auth.signed_in', { route: '/auth/callback' });

    // A deep link the user was sent to sign in for wins. Otherwise work
    // out where this account belongs: onboarding with no business, the
    // business itself with one, the selector with several.
    const fallback = await resolveCommandDestination();
    return NextResponse.redirect(appUrl(safeInternalPath(rawNext, fallback)));
  } catch (error) {
    logError('auth.callback_failed', error, { route: '/auth/callback' });
    return fail('link_invalid');
  }
}

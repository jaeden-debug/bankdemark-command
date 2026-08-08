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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_NEXT = /^\/[A-Za-z0-9/_-]*$/;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const rawNext = req.nextUrl.searchParams.get('next') ?? '/command';
  const next = SAFE_NEXT.test(rawNext) ? rawNext : '/command';

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
    return NextResponse.redirect(appUrl(next));
  } catch (error) {
    logError('auth.callback_failed', error, { route: '/auth/callback' });
    return fail('link_invalid');
  }
}

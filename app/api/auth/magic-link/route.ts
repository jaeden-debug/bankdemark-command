// ============================================================
// MAGIC-LINK REQUEST
//
// The redirect target is built server-side from the validated app
// origin, so a client cannot aim the link at another host, and it can
// never be localhost in production.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appUrl } from '@/lib/config/app-url';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Only internal paths may be returned to after sign-in. */
const SAFE_NEXT = /^\/[A-Za-z0-9/_-]*$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new ServiceError('validation', 'Enter a valid email address.');
    }

    // Only carry `next` when the caller actually asked for somewhere. A
    // manufactured default of '/command' is indistinguishable at the
    // callback from a user who deep-linked there on purpose, and it was
    // what forced every sign-in through the same fixed landing page.
    // Absent `next` now means "decide where I belong" — see
    // resolveCommandDestination.
    const next = typeof body?.next === 'string' && SAFE_NEXT.test(body.next) ? body.next : null;
    const redirectTo = appUrl(
      next ? `/auth/callback?next=${encodeURIComponent(next)}` : '/auth/callback'
    );

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new ServiceError('not_configured', 'Sign-in is not configured on this deployment.');
    }

    const supabase = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });

    if (error) {
      // Rate limiting is the one failure worth naming precisely.
      if (/rate/i.test(error.message)) {
        throw new ServiceError('rate_limited', 'Too many attempts. Wait a minute and try again.');
      }
      throw new ServiceError('upstream', 'Could not send the sign-in link. Try again.', {
        detail: error.message,
      });
    }

    logEvent('auth.magic_link_sent', { route: '/api/auth/magic-link' });
    // Deliberately identical whether or not the address has an account.
    return NextResponse.json({ ok: true });
  } catch (error) {
    const e = toServiceError(error, 'send a sign-in link');
    logError('auth.magic_link_failed', e, { route: '/api/auth/magic-link' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

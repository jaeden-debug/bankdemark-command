// ============================================================
// BANKDEMARK ECOSYSTEM SESSION COOKIES
//
// Command and Invoice are separate deployments of one BankDeMark
// account. Supabase writes its session to host-scoped cookies by
// default, so a session created on invoice.bankdemark.com would be
// invisible to command.bankdemark.com even though both read the same
// auth.users row.
//
// Scoping the cookie to the PARENT domain fixes that with no custom
// token passing: the browser sends the same cookie to every
// *.bankdemark.com host, and each app validates it with Supabase as
// it already does. RLS, service-role handling and entitlements are
// untouched.
//
// Deliberately production-only. On localhost a `domain` attribute
// would either be rejected or leak across ports, so development keeps
// the default host scoping.
// ============================================================

import type { CookieOptions } from '@supabase/ssr';

/** The apex the ecosystem shares. Every product runs under it. */
const ECOSYSTEM_DOMAIN = '.bankdemark.com';

function hostFrom(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

/**
 * True when this deployment is served from a bankdemark.com host.
 *
 * A preview deployment on *.vercel.app must NOT try to set a
 * bankdemark.com cookie — the browser would silently drop it and the
 * user could not sign in at all.
 */
export function usesEcosystemCookies(): boolean {
  const host =
    hostFrom(process.env.NEXT_PUBLIC_APP_URL) ??
    hostFrom(process.env.VERCEL_URL);

  if (!host) return false;
  return host === 'bankdemark.com' || host.endsWith('.bankdemark.com');
}

/**
 * Cookie options for the Supabase SSR client.
 *
 * Merged over whatever Supabase supplies, so its own `path`,
 * `maxAge` and `httpOnly` decisions are preserved — we only widen the
 * scope and harden transport.
 */
export function ecosystemCookieOptions(base: CookieOptions = {}): CookieOptions {
  if (!usesEcosystemCookies()) return base;

  return {
    ...base,
    domain: ECOSYSTEM_DOMAIN,
    // Same-site across subdomains: `lax` is sufficient and keeps the
    // cookie off cross-site requests. `none` would be needed only for
    // third-party embedding, which this product does not do.
    sameSite: base.sameSite ?? 'lax',
    secure: true,
    path: base.path ?? '/',
  };
}

/**
 * Sign-out must clear BOTH scopes.
 *
 * A session created before this change is host-scoped. If only the
 * parent-domain cookie were cleared, the stale host-scoped one would
 * remain and the user would appear signed in. Clearing both makes
 * sign-out consistent across the ecosystem.
 */
export function clearedCookieScopes(name: string): Array<{
  name: string;
  value: string;
  options: CookieOptions;
}> {
  const expired: CookieOptions = { path: '/', maxAge: 0, expires: new Date(0) };
  const scopes = [{ name, value: '', options: expired }];

  if (usesEcosystemCookies()) {
    scopes.push({
      name,
      value: '',
      options: { ...expired, domain: ECOSYSTEM_DOMAIN, secure: true },
    });
  }
  return scopes;
}

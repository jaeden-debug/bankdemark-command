// ============================================================
// APPLICATION ORIGIN
//
// The single source of every absolute URL: invoice share links, email
// links, magic-link redirects, PDF links, Stripe return URLs.
//
// The rule: localhost is allowed in development and FORBIDDEN in
// production. A missing or localhost origin in production throws
// rather than mailing a client a link they cannot open.
// ============================================================

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i;

function isProduction(): boolean {
  // VERCEL_ENV distinguishes preview from production; NODE_ENV alone
  // marks previews as production too, which would wrongly reject them.
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === 'production';
  return process.env.NODE_ENV === 'production';
}

function normalise(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).origin;
}

let cached: string | null = null;

/**
 * The origin this deployment is reachable at, e.g.
 * `https://invoice.bankdemark.com`.
 *
 * @throws in production when unset or pointing at localhost.
 */
export function appOrigin(): string {
  if (cached) return cached;

  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    // Vercel supplies this automatically for preview deployments.
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  if (!configured) {
    if (isProduction()) {
      throw new Error(
        'NEXT_PUBLIC_APP_URL is not set. Refusing to generate links in production — ' +
          'invoices and emails would point at localhost.'
      );
    }
    cached = 'http://localhost:3000';
    return cached;
  }

  let origin: string;
  try {
    origin = normalise(configured);
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL is not a valid URL: ${configured}`);
  }

  if (isProduction()) {
    if (LOCALHOST.test(origin)) {
      throw new Error(
        `NEXT_PUBLIC_APP_URL is "${origin}" in production. Set it to the deployed application URL.`
      );
    }
    if (!origin.startsWith('https://')) {
      throw new Error(`NEXT_PUBLIC_APP_URL must use https in production, got "${origin}".`);
    }
  }

  cached = origin;
  return cached;
}

/** Absolute URL for a path. `appUrl('/i/abc')` -> `https://…/i/abc`. */
export function appUrl(path = '/'): string {
  return `${appOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The private client-facing link for an issued invoice. */
export function invoiceShareUrl(token: string): string {
  return appUrl(`/i/${token}`);
}

/**
 * Non-throwing variant for surfaces that must still render when the
 * origin is misconfigured (a settings page explaining the problem).
 */
export function appOriginOrNull(): string | null {
  try {
    return appOrigin();
  } catch {
    return null;
  }
}

/** Only for tests. */
export function __resetAppOriginCache(): void {
  cached = null;
}

import type { MetadataRoute } from 'next';

// ============================================================
// ROBOTS — COMMAND
//
// Command is an authenticated financial workspace with two public
// pages in front of it. The posture is therefore DENY BY DEFAULT:
// name what may be crawled, block the rest.
//
// robots.txt controls CRAWLING, not indexing. It is the cheap outer
// layer — it keeps Googlebot out of paths that would only ever return
// a redirect to sign-in, and off the invoice share links. The binding
// instruction is the per-route `robots` metadata, because a URL that
// is merely disallowed can still be listed from an external link.
// Both layers are deliberate; neither is sufficient alone.
// ============================================================

const ORIGIN = 'https://command.bankdemark.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/command', // the public landing page
          '/pricing',
        ],
        disallow: [
          '/api/',

          // The whole multi-tenant workspace. Every one of these
          // 307s to sign-in for an anonymous request, so there is
          // nothing here to crawl even before authorization.
          '/b/',

          // Client-facing invoice links. Unguessable tokens, never
          // linked publicly, and already noindex/nofollow/nocache.
          // Blocked from crawling as well because fetching one
          // records a view — Googlebot must not appear in a client's
          // "who opened this invoice" history.
          '/i/',

          // Auth and setup. Thin, duplicated across the ecosystem,
          // and worthless as search results.
          '/auth/',
          '/onboarding',

          // Signed-in surfaces that live outside /b/.
          '/command/dashboard',
          '/command/wealth',
          '/command/debt',
          '/command/goals',
          '/command/reports',
          '/command/portfolio',
          '/command/affordability',
          '/command/marketplace',
          '/command/profile',
          '/command/onboarding',
        ],
      },
    ],
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}

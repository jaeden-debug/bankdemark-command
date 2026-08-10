import type { MetadataRoute } from 'next';

// ============================================================
// SITEMAP — COMMAND
//
// A sitemap is a claim that these URLs are worth indexing. Command
// has exactly two pages that qualify; everything else is behind auth
// or is a redirect. Listing more would advertise URLs that answer
// with a 307 to sign-in, which reads to Google as a broken site
// rather than a private one.
//
// The list is written out by hand rather than derived from the route
// tree. That is the point: a new route must be *decided* into the
// sitemap. Auto-discovery over an app whose routes are overwhelmingly
// private is how workspace URLs end up advertised to Google.
//
// Anything added here must also be allowed in app/robots.ts and must
// not carry `robots: { index: false }` in its own metadata. The three
// disagreeing is the classic way a page ends up crawled and not
// indexed with no explanation.
//
// No `lastModified`. A build-time timestamp on every URL is not a
// modification date, it is a deploy date, and stamping all of them on
// each deploy trains Google to ignore the field.
// ============================================================

const ORIGIN = 'https://command.bankdemark.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${ORIGIN}/command`,
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${ORIGIN}/pricing`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}

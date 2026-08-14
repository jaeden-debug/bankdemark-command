/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Chromium ships as a binary + native deps. Bundling it breaks the
    // executable path resolution at runtime, so both packages must stay
    // external for server-side PDF generation to work on Vercel.
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  },
  // ── Root redirect ────────────────────────────────────────────
  // `/` previously redirected via a Server Component calling
  // `redirect('/command')` in app/page.tsx. With no `dynamic` export the
  // route was statically prerendered, and the prerendered artifact went
  // out as a 307 carrying the Next.js error HTML as its BODY and no
  // `Location` header at all. Vercel then cached it: production served
  // `age: 320917` (~3.7 days) with `x-vercel-cache: HIT`, so every new
  // visitor to the bare domain got an error page.
  //
  // Handled here instead. A config redirect is applied by Vercel at the
  // edge before any rendering happens, so it always emits a real
  // `Location` header and can never render — or cache — an error body.
  //
  // Deliberately TEMPORARY (307) rather than permanent. `/` is not a
  // search target, so there is no ranking reason to make it permanent,
  // and a 308 is cached by browsers indefinitely — which would make
  // moving the app entry later a support problem rather than a deploy.
  async redirects() {
    return [
      {
        source: '/',
        destination: '/command',
        permanent: false,
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

module.exports = nextConfig;

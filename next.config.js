/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Chromium ships as a binary + native deps. Bundling it breaks the
    // executable path resolution at runtime, so both packages must stay
    // external for server-side PDF generation to work on Vercel.
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
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

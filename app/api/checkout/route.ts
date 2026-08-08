// ============================================================
// LEGACY CHECKOUT ENDPOINT
//
// Superseded by /api/billing/checkout, which resolves prices from
// lib/config/plans.ts. Kept as a redirect so any older client still
// reaches the one supported billing path instead of a second,
// divergent implementation.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const url = new URL('/api/billing/checkout', req.nextUrl.origin);
  return NextResponse.json(
    {
      error: 'This endpoint has moved.',
      code: 'moved',
      use: url.pathname,
    },
    { status: 410 }
  );
}

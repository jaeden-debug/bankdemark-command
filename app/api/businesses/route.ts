import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/services/context';
import { createBusiness, listBusinesses, seedStarterAccounts } from '@/lib/services/businesses';
import { logError, logEvent, toServiceError } from '@/lib/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const businesses = await listBusinesses();
    return NextResponse.json({ businesses });
  } catch (error) {
    const e = toServiceError(error, 'load your businesses');
    logError('businesses.list_failed', e, { route: '/api/businesses' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await requireUser();
    const body = await req.json();

    const business = await createBusiness(
      {
        name: String(body?.name ?? ''),
        businessType: String(body?.businessType ?? ''),
        revenueModel: Array.isArray(body?.revenueModel) ? body.revenueModel.map(String) : undefined,
        country: body?.country ? String(body.country) : undefined,
        region: body?.region ? String(body.region) : null,
        baseCurrency: body?.baseCurrency ? String(body.baseCurrency) : undefined,
        fiscalYearStartMonth: Number(body?.fiscalYearStartMonth) || 1,
        taxJurisdiction: body?.taxJurisdiction ? String(body.taxJurisdiction) : null,
        earnsCommissions: Boolean(body?.earnsCommissions),
        handlesClientFunds: Boolean(body?.handlesClientFunds),
        brandModel: ['none', 'brands', 'group'].includes(body?.brandModel) ? body.brandModel : 'none',
        brands: Array.isArray(body?.brands) ? body.brands.map(String) : undefined,
      },
      auth
    );

    // A new business should never be a blank page.
    await seedStarterAccounts(auth, business.id, business.base_currency, business.business_type);

    logEvent('business.created', { requestId, userId: auth.userId, businessId: business.id });
    return NextResponse.json({ business });
  } catch (error) {
    const e = toServiceError(error, 'create that business');
    logError('businesses.create_failed', e, { requestId, route: '/api/businesses' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

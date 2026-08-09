import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { getCommissionReport } from '@/lib/services/commission-reports';
import { ServiceError, toServiceError } from '@/lib/services/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { documentId: string } }) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'viewer');
    return NextResponse.json(await getCommissionReport(ctx, params.documentId));
  } catch (error) {
    const e = toServiceError(error, 'load that commission report');
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

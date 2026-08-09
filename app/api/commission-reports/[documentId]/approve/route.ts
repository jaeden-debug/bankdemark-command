import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { approveCommissionReport } from '@/lib/services/commission-reports';
import { ServiceError, logEvent, toServiceError } from '@/lib/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { documentId: string } }) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body.businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(String(body.businessId), 'member');
    const result = await approveCommissionReport(ctx, params.documentId);
    logEvent('commission_report.approved', { requestId, businessId: ctx.businessId, documentId: params.documentId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const e = toServiceError(error, 'approve that commission report');
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

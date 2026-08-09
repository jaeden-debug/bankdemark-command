import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { getSignedUrl } from '@/lib/services/documents';
import { ServiceError, toServiceError } from '@/lib/services/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { documentId: string } }) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'viewer');
    return NextResponse.redirect(await getSignedUrl(ctx, params.documentId));
  } catch (error) {
    const e = toServiceError(error, 'open that document');
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

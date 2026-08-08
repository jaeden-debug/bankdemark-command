import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, toServiceError } from '@/lib/services/errors';
import { generateProfitAndLoss, profitAndLossToCsv } from '@/lib/services/reports';
import { resolvePeriod, type PeriodPreset } from '@/lib/services/finance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRESETS: PeriodPreset[] = [
  'this_month', 'last_month', 'this_quarter', 'this_year',
  'last_year', 'last_30_days', 'last_90_days', 'all_time',
];

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const businessId = p.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(businessId, 'viewer');

    const presetParam = p.get('period') as PeriodPreset | null;
    const preset: PeriodPreset =
      presetParam && PRESETS.includes(presetParam) ? presetParam : 'this_month';
    const period = resolvePeriod(preset);

    const report = await generateProfitAndLoss(ctx, period);

    if (p.get('format') === 'csv') {
      const filename = `profit-and-loss-${period.from}-to-${period.to}.csv`;
      return new NextResponse(profitAndLossToCsv(report), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    const e = toServiceError(error, 'generate that report');
    logError('reports.failed', e, { route: '/api/reports' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { commitImport, previewImport, MAX_IMPORT_ROWS } from '@/lib/services/imports';
import { isEnabled } from '@/lib/services/entitlements';
import type { DateOrder } from '@/lib/domain/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Roughly 5MB of CSV text. Larger files belong in a background job,
// which does not exist yet, so we refuse rather than time out.
const MAX_CHARS = 5_000_000;

const ORDERS: DateOrder[] = ['ymd', 'mdy', 'dmy', 'unknown'];

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    if (!body?.accountId) throw new ServiceError('validation', 'Choose which account this file is for.');

    const ctx = await requireBusiness(String(body.businessId), 'member');

    const { data: profile } = await ctx.db
      .from('profiles').select('plan').eq('id', ctx.userId).single();
    if (!isEnabled(profile?.plan ?? 'free', 'csv_import')) {
      throw new ServiceError('forbidden', 'CSV import is not included in your plan.');
    }

    const csvText = String(body.csv ?? '');
    if (!csvText.trim()) throw new ServiceError('validation', 'That file appears to be empty.');
    if (csvText.length > MAX_CHARS) {
      throw new ServiceError(
        'validation',
        `That file is too large. Split it into files of under ${MAX_IMPORT_ROWS.toLocaleString()} rows.`
      );
    }

    const dateOrderOverride =
      body.dateOrder && ORDERS.includes(body.dateOrder) ? (body.dateOrder as DateOrder) : undefined;

    if (body.action === 'commit') {
      const result = await commitImport(ctx, String(body.accountId), csvText, {
        dateOrderOverride,
        filename: body.filename ? String(body.filename) : undefined,
      });
      logEvent('import.committed', {
        requestId, businessId: ctx.businessId, imported: result.importedCount,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const preview = await previewImport(ctx, String(body.accountId), csvText, { dateOrderOverride });
    // The full row set can be large; the client only renders a sample.
    return NextResponse.json({
      ok: true,
      ...preview,
      rows: preview.rows.slice(0, 100),
      sampledRows: preview.rows.length,
    });
  } catch (error) {
    const e = toServiceError(error, 'read that file');
    logError('imports.failed', e, { requestId, route: '/api/imports' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

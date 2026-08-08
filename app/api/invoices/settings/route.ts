// ============================================================
// INVOICE SETTINGS AND CUSTOM FIELD DEFINITIONS
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, toServiceError } from '@/lib/services/errors';
import {
  getInvoiceSettings,
  updateInvoiceSettings,
  listCustomFields,
  createCustomField,
  deleteCustomField,
  listTaxRates,
} from '@/lib/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'viewer');

    const [settings, customFields, taxRates] = await Promise.all([
      getInvoiceSettings(ctx),
      listCustomFields(ctx),
      listTaxRates(ctx),
    ]);
    return NextResponse.json({ settings, customFields, taxRates });
  } catch (error) {
    const e = toServiceError(error, 'load invoice settings');
    logError('invoice.settings_get_failed', e, { route: '/api/invoices/settings' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(String(body.businessId), 'admin');

    if (body.addCustomField) {
      const field = await createCustomField(
        ctx,
        {
          label: String(body.addCustomField.label ?? ''),
          fieldType: body.addCustomField.fieldType,
          helpText: body.addCustomField.helpText ?? null,
        },
        { actorType: 'user', source: 'manual', requestId }
      );
      return NextResponse.json({ ok: true, field });
    }

    if (body.removeCustomFieldId) {
      await deleteCustomField(ctx, String(body.removeCustomFieldId), {
        actorType: 'user',
        source: 'manual',
        requestId,
      });
      return NextResponse.json({ ok: true });
    }

    const settings = await updateInvoiceSettings(ctx, body.settings ?? {}, {
      actorType: 'user',
      source: 'manual',
      requestId,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const e = toServiceError(error, 'save invoice settings');
    logError('invoice.settings_patch_failed', e, { requestId });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

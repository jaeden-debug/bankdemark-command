// ============================================================
// BUSINESS LOGO UPLOAD
//
// Stored at `<business_id>/<name>` in a PRIVATE bucket. The first path
// segment is the tenant, and storage RLS checks membership against it,
// so one business can never read or overwrite another's logo.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, toServiceError } from '@/lib/services/errors';
import { getAccess, requireCapability } from '@/lib/services/access';
import { getInvoiceSettings, updateInvoiceSettings } from '@/lib/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Magic-byte check, so a renamed executable cannot pose as an image. */
function sniff(buf: Buffer, declared: string): boolean {
  if (declared === 'image/png') {
    return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (declared === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (declared === 'image/webp') {
    return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  }
  if (declared === 'image/svg+xml') {
    const head = buf.subarray(0, 1024).toString('utf8').toLowerCase();
    // Reject SVGs carrying script or external references.
    if (/<script|javascript:|onload=|<foreignobject/i.test(head)) return false;
    return head.includes('<svg');
  }
  return false;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const form = await req.formData();
    const businessId = String(form.get('businessId') ?? '');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');

    const ctx = await requireBusiness(businessId, 'admin');
    requireCapability(await getAccess(ctx), 'logoBranding', 'Adding your logo');

    const file = form.get('file');
    if (!(file instanceof File)) throw new ServiceError('validation', 'Choose an image to upload.');
    if (file.size === 0) throw new ServiceError('validation', 'That file is empty.');
    if (file.size > MAX_BYTES) {
      throw new ServiceError('validation', 'That image is larger than 2 MB. Use a smaller one.');
    }

    const ext = ALLOWED[file.type];
    if (!ext) {
      throw new ServiceError('validation', 'Use a PNG, JPG, WEBP or SVG image.');
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!sniff(buf, file.type)) {
      throw new ServiceError('validation', 'That file is not a valid image.');
    }

    // Deterministic name, so replacing a logo does not orphan the old one.
    const path = `${ctx.businessId}/logo.${ext}`;

    const { error: uploadError } = await ctx.db.storage
      .from('business-logos')
      .upload(path, buf, { contentType: file.type, upsert: true });

    if (uploadError) {
      logError('logo.upload_failed', uploadError, { businessId: ctx.businessId });
      throw new ServiceError('internal', 'Could not store that image.');
    }

    // Remove a stale logo in a different format.
    const stale = Object.values(ALLOWED)
      .filter((e) => e !== ext)
      .map((e) => `${ctx.businessId}/logo.${e}`);
    await ctx.db.storage.from('business-logos').remove(stale).catch?.(() => {});

    await updateInvoiceSettings(ctx, { logo_path: path }, {
      actorType: 'user', source: 'manual', requestId,
    });

    return NextResponse.json({ ok: true, path });
  } catch (error) {
    const e = toServiceError(error, 'upload that logo');
    logError('logo.failed', e, { requestId });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'admin');

    const settings = await getInvoiceSettings(ctx);
    if (settings.logo_path) {
      await ctx.db.storage.from('business-logos').remove([settings.logo_path]);
    }
    await updateInvoiceSettings(ctx, { logo_path: null }, { actorType: 'user', source: 'manual' });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const e = toServiceError(error, 'remove that logo');
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

/** Short-lived signed URL for previewing the current logo. */
export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'viewer');

    const settings = await getInvoiceSettings(ctx);
    if (!settings.logo_path) return NextResponse.json({ url: null });

    const { data } = await ctx.db.storage
      .from('business-logos')
      .createSignedUrl(settings.logo_path, 60 * 10);

    return NextResponse.json({ url: data?.signedUrl ?? null, path: settings.logo_path });
  } catch (error) {
    const e = toServiceError(error, 'load that logo');
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

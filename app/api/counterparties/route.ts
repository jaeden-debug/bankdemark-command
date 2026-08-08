import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, toServiceError } from '@/lib/services/errors';
import {
  listCounterparties,
  createCounterparty,
  updateCounterparty,
  archiveCounterparty,
  type CounterpartyKind,
} from '@/lib/services/counterparties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const businessId = p.get('businessId');
    if (!businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(businessId, 'viewer');
    return NextResponse.json({
      counterparties: await listCounterparties(ctx, {
        kind: (p.get('kind') as CounterpartyKind) ?? undefined,
      }),
    });
  } catch (error) {
    const e = toServiceError(error, 'load clients');
    logError('counterparties.list_failed', e, { route: '/api/counterparties' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    const ctx = await requireBusiness(String(body.businessId), 'member');

    const counterparty = await createCounterparty(
      ctx,
      {
        name: String(body.name ?? ''),
        kind: body.kind,
        email: body.email ?? null,
        phone: body.phone ?? null,
        notes: body.notes ?? null,
      },
      { actorType: 'user', source: 'manual', requestId }
    );
    return NextResponse.json({ ok: true, counterparty });
  } catch (error) {
    const e = toServiceError(error, 'save that client');
    logError('counterparties.create_failed', e, { requestId });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    if (!body?.businessId || !body?.id) {
      throw new ServiceError('validation', 'Missing business or client.');
    }
    const ctx = await requireBusiness(String(body.businessId), 'member');

    if (body.action === 'archive') {
      await archiveCounterparty(ctx, String(body.id), {
        actorType: 'user', source: 'manual', requestId,
      });
      return NextResponse.json({ ok: true });
    }

    const counterparty = await updateCounterparty(
      ctx,
      String(body.id),
      { name: body.name, kind: body.kind, email: body.email, phone: body.phone, notes: body.notes },
      { actorType: 'user', source: 'manual', requestId }
    );
    return NextResponse.json({ ok: true, counterparty });
  } catch (error) {
    const e = toServiceError(error, 'update that client');
    logError('counterparties.update_failed', e, { requestId });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

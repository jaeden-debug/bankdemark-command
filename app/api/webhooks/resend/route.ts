// ============================================================
// RESEND WEBHOOK
//
// Provider truth about what happened to an email after we handed it
// over. "The API accepted the request" is NOT delivery — only a
// `email.delivered` event is.
//
// Signature: Resend signs with Svix headers (svix-id, svix-timestamp,
// svix-signature) using an HMAC-SHA256 over `id.timestamp.body`.
// Verified here without pulling in the svix SDK.
//
// Idempotency: every event id is recorded with a unique constraint. A
// replay inserts nothing and applies nothing.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb } from '@/lib/services/context';
import { logError, logEvent } from '@/lib/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reject events older than this to blunt replay attacks. */
const TOLERANCE_SECONDS = 5 * 60;

function verify(raw: string, headers: Headers, secret: string): boolean {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  // Secret is `whsec_<base64>`; the bytes after the prefix are the key.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64');

  // Header may carry several space-separated `v1,<sig>` values.
  return signatureHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    const a = Buffer.from(sig ?? '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Resend event type -> our delivery state and timestamp column. */
const EVENT_MAP: Record<string, { state: string; column?: string; terminal?: boolean }> = {
  'email.sent': { state: 'sent' },
  'email.delivered': { state: 'delivered', column: 'delivered_at' },
  'email.delivery_delayed': { state: 'sent' },
  'email.bounced': { state: 'bounced', column: 'bounced_at', terminal: true },
  'email.complained': { state: 'bounced', column: 'bounced_at', terminal: true },
  'email.failed': { state: 'failed', column: 'failed_at', terminal: true },
  'email.opened': { state: 'delivered', column: 'opened_at' },
};

/** Once bounced or failed, a later "sent" must not overwrite it. */
const RANK: Record<string, number> = {
  queued: 0, sent: 1, delivered: 2, bounced: 3, failed: 3,
};

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logError('resend_webhook.not_configured', new Error('RESEND_WEBHOOK_SECRET missing'), {});
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 500 });
  }

  const raw = await req.text();
  if (!verify(raw, req.headers, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let event: {
    type?: string;
    created_at?: string;
    data?: { email_id?: string; tags?: Record<string, string> | Array<{ name: string; value: string }>; bounce?: { type?: string }; reason?: string };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const eventId = req.headers.get('svix-id')!;
  const type = event.type ?? 'unknown';
  const db = adminDb();

  // ── Idempotency gate. A replay stops here. ──
  const claim = await db
    .from('provider_webhook_events')
    .insert({ provider: 'resend', event_id: eventId, event_type: type, payload: event as never })
    .select('id')
    .single();

  if (claim.error) {
    if (claim.error.code === '23505') {
      // Already processed. Acknowledge so Resend stops retrying.
      return NextResponse.json({ ok: true, duplicate: true });
    }
    logError('resend_webhook.claim_failed', claim.error, {});
    return NextResponse.json({ error: 'Could not record event.' }, { status: 500 });
  }

  const mapped = EVENT_MAP[type];
  if (!mapped) return NextResponse.json({ ok: true, ignored: type });

  const messageId = event.data?.email_id;
  if (!messageId) return NextResponse.json({ ok: true, ignored: 'no_message_id' });

  try {
    const { data: delivery } = await db
      .from('invoice_deliveries')
      .select('id, invoice_id, business_id, state')
      .eq('provider_message_id', messageId)
      .maybeSingle();

    if (!delivery) return NextResponse.json({ ok: true, ignored: 'unknown_message' });

    // Never move a delivery backwards.
    const currentRank = RANK[delivery.state as string] ?? 0;
    const nextRank = RANK[mapped.state] ?? 0;
    if (nextRank < currentRank) {
      return NextResponse.json({ ok: true, ignored: 'stale_event' });
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { state: mapped.state, last_event_at: now };
    if (mapped.column) update[mapped.column] = now;
    if (event.data?.bounce?.type) update.bounce_type = event.data.bounce.type;
    if (mapped.terminal) {
      update.error = event.data?.reason ?? event.data?.bounce?.type ?? type;
    }

    await db.from('invoice_deliveries').update(update as never).eq('id', delivery.id);

    // A bounce is worth surfacing on the invoice timeline; a delivery
    // confirmation is too, because "did they get it?" is the question
    // the user actually has.
    if (mapped.state === 'delivered' || mapped.terminal) {
      await db.from('invoice_events').insert({
        invoice_id: delivery.invoice_id,
        business_id: delivery.business_id,
        actor_user_id: null,
        actor_type: 'system',
        event: mapped.state === 'delivered' ? 'email_delivered' : `email_${mapped.state}`,
        detail: {
          provider: 'resend',
          reason: event.data?.reason ?? event.data?.bounce?.type ?? null,
        } as never,
      });
    }

    logEvent('resend_webhook.applied', { type, state: mapped.state });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError('resend_webhook.apply_failed', error, {});
    // 500 so Resend retries; the idempotency row means the retry is safe.
    return NextResponse.json({ error: 'Could not apply event.' }, { status: 500 });
  }
}

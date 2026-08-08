// ============================================================
// STRIPE WEBHOOK — the authority on subscription state
//
// A success redirect proves nothing: the user can navigate to it, and
// the payment may still fail. Plan changes happen HERE and only here.
//
// Idempotency: every event id is claimed in provider_webhook_events
// under a unique constraint. Stripe retries are no-ops.
//
// Founder accounts are never demoted by billing events.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { adminDb } from '@/lib/services/context';
import { logError, logEvent } from '@/lib/services/errors';
import { planForPriceId, type PlanId } from '@/lib/config/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Statuses that entitle the customer to their paid plan. */
const ENTITLING = new Set(['active', 'trialing']);

type Db = ReturnType<typeof adminDb>;

async function applySubscription(
  db: Db,
  userId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const plan: PlanId = planForPriceId(priceId) ?? 'free';
  const entitled = ENTITLING.has(sub.status);
  const effectivePlan: PlanId = entitled ? plan : 'free';

  // `current_period_end` sits on the subscription item in newer API
  // versions; fall back across both shapes rather than guessing.
  const periodEndRaw =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items.data[0] as unknown as { current_period_end?: number } | undefined)
      ?.current_period_end ??
    null;

  await db.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      price_id: priceId,
      plan: effectivePlan,
      status: sub.status,
      current_period_end: periodEndRaw ? new Date(periodEndRaw * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  // Never demote a founder. Their plan is granted by the allow-list
  // trigger and has nothing to do with billing.
  const { data: profile } = await db
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.plan === 'founder') {
    logEvent('stripe_webhook.founder_plan_preserved', { userId });
    return;
  }

  await db
    .from('profiles')
    .update({ plan: effectivePlan, updated_at: new Date().toISOString() })
    .eq('id', userId);

  logEvent('stripe_webhook.plan_applied', { userId, plan: effectivePlan, status: sub.status });
}

/** Resolve our user from the event, preferring explicit metadata. */
async function resolveUserId(
  db: Db,
  metadataUserId: string | null | undefined,
  customerId: string | null
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;
  const { data } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logError('stripe_webhook.not_configured', new Error('STRIPE_WEBHOOK_SECRET missing'), {});
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'No signature.' }, { status: 400 });

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (error) {
    logError('stripe_webhook.signature_failed', error, {});
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const db = adminDb();

  // ── Idempotency gate ──
  const claim = await db
    .from('provider_webhook_events')
    .insert({
      provider: 'stripe',
      event_id: event.id,
      event_type: event.type,
      payload: null, // Stripe payloads can carry PII; the id is enough.
    })
    .select('id')
    .single();

  if (claim.error) {
    if (claim.error.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    logError('stripe_webhook.claim_failed', claim.error, {});
    return NextResponse.json({ error: 'Could not record event.' }, { status: 500 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription' || !session.subscription) break;

        const userId =
          session.metadata?.user_id ?? session.client_reference_id ?? null;
        if (!userId) {
          logError('stripe_webhook.no_user', new Error('checkout without user_id'), {});
          break;
        }

        const sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id
        );
        await applySubscription(db, userId, sub);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const userId = await resolveUserId(db, sub.metadata?.user_id, customerId);
        if (!userId) break;

        if (event.type === 'customer.subscription.deleted') {
          // Cancelled: back to Free, keeping every historical invoice.
          await applySubscription(db, userId, { ...sub, status: 'canceled' } as Stripe.Subscription);
        } else {
          await applySubscription(db, userId, sub);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
        const userId = await resolveUserId(db, null, customerId);
        if (!userId) break;

        // Record the state. Access is not revoked here — Stripe moves
        // the subscription to past_due/unpaid and sends its own event,
        // which is what actually changes the plan.
        await db
          .from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('user_id', userId);
        logEvent('stripe_webhook.payment_failed', { userId });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logError('stripe_webhook.apply_failed', error, { eventType: event.type });
    // 500 so Stripe retries; the claim row makes the retry safe because
    // applySubscription is itself an upsert.
    return NextResponse.json({ error: 'Could not apply event.' }, { status: 500 });
  }
}

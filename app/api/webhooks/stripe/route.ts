import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';

// Required for raw body parsing — Next.js App Router streams the body
export const config = { api: { bodyParser: false } };

async function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase admin credentials.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function setPlan(
  supabase: Awaited<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  plan: 'pro' | 'free',
  extra: Record<string, string | null> = {}
) {
  const { error } = await supabase
    .from('profiles')
    .update({ plan, ...extra, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
  console.log(`[stripe-webhook] set plan=${plan} for user=${userId}`);
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'No signature.' }, { status: 400 });

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: ReturnType<typeof stripe.webhooks.constructEvent> extends Promise<infer T> ? T : ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseAdmin();

    switch (event.type) {
      // ── One-time payment (lifetime) OR subscription checkout ──────────────
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const userId = session.metadata?.user_id;
        if (!userId) { console.warn('[stripe-webhook] No user_id in metadata'); break; }

        const plan = session.metadata?.plan ?? 'monthly';
        const stripeCustomerId = session.customer ?? null;
        const subscriptionId = session.subscription ?? null;

        await setPlan(supabase, userId, 'pro', {
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: subscriptionId,
          pro_plan: plan,
        });
        break;
      }

      // ── Subscription renewed ───────────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        const subId = invoice.subscription;
        if (!subId) break;

        // Look up user by stripe_subscription_id
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .single();

        if (profile) await setPlan(supabase, profile.id, 'pro');
        break;
      }

      // ── Subscription cancelled / payment failed ────────────────────────────
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const obj = event.data.object as any;
        const subId = obj.subscription ?? obj.id;
        if (!subId) break;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .single();

        if (profile) await setPlan(supabase, profile.id, 'free');
        break;
      }

      default:
        // Unhandled event — just acknowledge
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[stripe-webhook] Handler error:', err);
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 });
  }
}

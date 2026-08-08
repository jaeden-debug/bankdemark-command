// ============================================================
// STRIPE CHECKOUT
//
// Price ids come from lib/config/plans.ts, never from the request —
// a client cannot ask to be charged for a different price.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { requireUser } from '@/lib/services/context';
import { ServiceError, logError, toServiceError } from '@/lib/services/errors';
import { appUrl } from '@/lib/config/app-url';
import { stripePriceId, PURCHASABLE_PLANS, type PlanId } from '@/lib/config/plans';
import { getAccess } from '@/lib/services/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plan = String(body?.plan ?? '') as PlanId;

    if (!PURCHASABLE_PLANS.includes(plan) || plan === 'free') {
      throw new ServiceError('validation', 'Choose a paid plan.');
    }

    // Authenticate first: an anonymous caller must not be able to probe
    // which plans are configured on this deployment.
    const auth = await requireUser();

    const priceId = stripePriceId(plan);
    if (!priceId) {
      throw new ServiceError(
        'not_configured',
        `Billing is not configured for the ${plan} plan on this deployment.`
      );
    }

    const access = await getAccess(auth);
    if (access.unrestricted) {
      throw new ServiceError('conflict', 'This account already has unrestricted access.');
    }

    // Reuse the Stripe customer if this user has one, so upgrades do
    // not create a second customer record.
    const { data: existing } = await auth.db
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', auth.userId)
      .maybeSingle();

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: existing?.stripe_customer_id ?? undefined,
      customer_email: existing?.stripe_customer_id ? undefined : auth.email ?? undefined,
      client_reference_id: auth.userId,
      // The webhook is the authority; metadata is how it finds the user.
      metadata: { user_id: auth.userId, plan },
      subscription_data: { metadata: { user_id: auth.userId, plan } },
      allow_promotion_codes: true,
      success_url: appUrl('/command/account?checkout=success'),
      cancel_url: appUrl('/pricing?checkout=cancelled'),
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    const e = toServiceError(error, 'start checkout');
    logError('billing.checkout_failed', e, { route: '/api/billing/checkout' });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

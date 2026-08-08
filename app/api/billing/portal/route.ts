import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { requireUser } from '@/lib/services/context';
import { ServiceError, logError, toServiceError } from '@/lib/services/errors';
import { appUrl } from '@/lib/config/app-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Upgrade, downgrade, cancel and payment method all live in the portal. */
export async function POST() {
  try {
    const auth = await requireUser();
    const { data: sub } = await auth.db
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      throw new ServiceError('not_found', 'There is no subscription on this account yet.');
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: appUrl('/command/account'),
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    const e = toServiceError(error, 'open the billing portal');
    logError('billing.portal_failed', e, {});
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}

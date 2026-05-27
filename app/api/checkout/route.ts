import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

type Plan = 'monthly' | 'yearly' | 'lifetime';

const PRICE_ENV: Record<Plan, string> = {
  monthly: 'STRIPE_MONTHLY_PRICE_ID',
  yearly: 'STRIPE_YEARLY_PRICE_ID',
  lifetime: 'STRIPE_LIFETIME_PRICE_ID',
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const plan = body?.plan as Plan;

    if (!plan || !PRICE_ENV[plan]) {
      return NextResponse.json(
        { error: `Invalid plan: ${String(plan)}` },
        { status: 400 }
      );
    }

    const priceId = process.env[PRICE_ENV[plan]];

    if (!priceId) {
      return NextResponse.json(
        { error: `Missing env var: ${PRICE_ENV[plan]}` },
        { status: 500 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: plan === 'lifetime' ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/command/dashboard?upgraded=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/command/dashboard?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[Stripe checkout]', err);

    return NextResponse.json(
      {
        error: err?.message || 'Stripe checkout failed.',
        code: err?.code || null,
        type: err?.type || null,
      },
      { status: err?.statusCode || 500 }
    );
  }
}

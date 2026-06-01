import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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
      return NextResponse.json({ error: `Invalid plan: ${String(plan)}` }, { status: 400 });
    }

    const priceId = process.env[PRICE_ENV[plan]];
    if (!priceId) {
      return NextResponse.json({ error: `Missing env var: ${PRICE_ENV[plan]}` }, { status: 500 });
    }

    // Get authenticated user so we can tag the session with their ID
    let userId: string | null = null;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      try {
        const cookieStore = await cookies();
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll: () => cookieStore.getAll(),
              setAll: () => {},
            },
          }
        );
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id ?? null;
      } catch {}
    }

    const stripe = getStripe();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: plan === 'lifetime' ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        plan,
        ...(userId ? { user_id: userId } : {}),
      },
      ...(plan !== 'lifetime'
        ? {
            subscription_data: {
              metadata: { plan, ...(userId ? { user_id: userId } : {}) },
            },
          }
        : {}),
      success_url: `${appUrl}/command/dashboard?upgraded=true`,
      cancel_url: `${appUrl}/command/dashboard?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[Stripe checkout]', err);
    return NextResponse.json(
      { error: err?.message || 'Stripe checkout failed.', code: err?.code || null },
      { status: err?.statusCode || 500 }
    );
  }
}

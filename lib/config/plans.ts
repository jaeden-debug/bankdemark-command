// ============================================================
// PLANS — the single place prices and limits are defined
//
// Stripe price IDs live in env vars and are mapped here, never
// hard-coded at call sites. Changing a price is one env var plus one
// line in this file.
//
// All prices are CAD, in minor units.
// ============================================================

export type PlanId = 'free' | 'starter' | 'pro' | 'business' | 'founder';

/** Plans a customer can actually buy, in upgrade order. */
export const PURCHASABLE_PLANS: PlanId[] = ['free', 'starter', 'pro', 'business'];

export interface PlanLimits {
  /** null = unlimited. */
  businesses: number | null;
  activeClients: number | null;
  invoicesPerMonth: number | null;
  aiActionsPerMonth: number | null;
  emailSending: boolean;
  deliveryTracking: boolean;
  logoBranding: boolean;
  whiteLabel: boolean;
  creditNotes: boolean;
  advancedReporting: boolean;
  prioritySupport: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** CAD minor units per month. null = not purchasable. */
  priceMinor: number | null;
  currency: 'CAD';
  /** Env var holding the Stripe price id. */
  priceEnv?: string;
  limits: PlanLimits;
  /** Marketing bullets. Only things that actually work. */
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Send your first invoices and see if it fits.',
    priceMinor: 0,
    currency: 'CAD',
    limits: {
      businesses: 1,
      activeClients: 1,
      invoicesPerMonth: 3,
      // One introductory draft, then Zylx invoice drafting is off.
      aiActionsPerMonth: 1,
      emailSending: true,
      deliveryTracking: false,
      logoBranding: false,
      whiteLabel: false,
      creditNotes: false,
      advancedReporting: false,
      prioritySupport: false,
    },
    features: [
      '1 business, 1 client',
      '3 invoices a month',
      'Professional PDF and private client link',
      'Email invoices to your client',
      'Record payments, partial or full',
      '1 Zylx AI draft to try it out',
    ],
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a freelancer or solo operator billing regularly.',
    priceMinor: 1200,
    currency: 'CAD',
    priceEnv: 'STRIPE_PRICE_STARTER',
    limits: {
      businesses: 1,
      activeClients: 25,
      invoicesPerMonth: 50,
      aiActionsPerMonth: 20,
      emailSending: true,
      deliveryTracking: true,
      logoBranding: true,
      whiteLabel: false,
      creditNotes: true,
      advancedReporting: false,
      prioritySupport: false,
    },
    features: [
      'Everything in Free',
      '25 clients, 50 invoices a month',
      'Your logo and branding on every invoice',
      'Delivery tracking — see delivered and bounced',
      '20 Zylx AI drafts a month',
      'Credit notes and revisions',
    ],
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For a serious solo or small business.',
    priceMinor: 2400,
    currency: 'CAD',
    priceEnv: 'STRIPE_PRICE_PRO',
    limits: {
      businesses: 3,
      activeClients: null,
      invoicesPerMonth: 250,
      aiActionsPerMonth: 100,
      emailSending: true,
      deliveryTracking: true,
      logoBranding: true,
      whiteLabel: true,
      creditNotes: true,
      advancedReporting: true,
      prioritySupport: false,
    },
    features: [
      'Everything in Starter',
      '3 businesses, unlimited clients',
      '250 invoices a month',
      'Full white-label — no BankDeMark credit',
      '100 Zylx AI drafts a month',
      'Advanced reporting',
    ],
  },

  business: {
    id: 'business',
    name: 'Business',
    tagline: 'For a growing operation with several books.',
    priceMinor: 4900,
    currency: 'CAD',
    priceEnv: 'STRIPE_PRICE_BUSINESS',
    limits: {
      businesses: 10,
      activeClients: null,
      // Not literally unlimited — a ceiling high enough that no real
      // business reaches it, low enough to stop a runaway integration.
      invoicesPerMonth: 5000,
      aiActionsPerMonth: 500,
      emailSending: true,
      deliveryTracking: true,
      logoBranding: true,
      whiteLabel: true,
      creditNotes: true,
      advancedReporting: true,
      prioritySupport: true,
    },
    features: [
      'Everything in Pro',
      '10 businesses',
      'Effectively unlimited invoices',
      '500 Zylx AI actions a month',
      'Advanced reporting across businesses',
      'Priority support',
    ],
  },

  // Not purchasable. Granted only by the founder_emails allow-list.
  founder: {
    id: 'founder',
    name: 'Founder',
    tagline: 'Unrestricted.',
    priceMinor: null,
    currency: 'CAD',
    limits: {
      businesses: null,
      activeClients: null,
      invoicesPerMonth: null,
      aiActionsPerMonth: null,
      emailSending: true,
      deliveryTracking: true,
      logoBranding: true,
      whiteLabel: true,
      creditNotes: true,
      advancedReporting: true,
      prioritySupport: true,
    },
    features: ['Everything, without limits'],
  },
};

export function planFor(plan: string | null | undefined): PlanDefinition {
  const id = (plan ?? 'free') as PlanId;
  return PLANS[id] ?? PLANS.free;
}

/** Stripe price id for a plan, or null when not configured. */
export function stripePriceId(plan: PlanId): string | null {
  const env = PLANS[plan]?.priceEnv;
  if (!env) return null;
  return process.env[env]?.trim() || null;
}

/** Reverse map: a Stripe price id back to our plan. */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const id of PURCHASABLE_PLANS) {
    if (id !== 'free' && stripePriceId(id) === priceId) return id;
  }
  return null;
}

export function formatPlanPrice(plan: PlanDefinition): string {
  if (plan.priceMinor === null) return '—';
  if (plan.priceMinor === 0) return 'Free';
  return `$${(plan.priceMinor / 100).toFixed(0)}`;
}

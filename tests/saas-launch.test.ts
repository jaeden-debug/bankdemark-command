// ============================================================
// LAUNCH-CRITICAL UNIT TESTS
//
// Deliberately narrow: the pure logic that protects money, tenancy
// and access. Anything needing a live database is covered by the SQL
// suite instead of being mocked into meaninglessness here.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PLANS, PURCHASABLE_PLANS, planForPriceId, stripePriceId, formatPlanPrice } from '../lib/config/plans';
import { appOrigin, appUrl, invoiceShareUrl, __resetAppOriginCache } from '../lib/config/app-url';

const ENV = { ...process.env };

beforeEach(() => {
  __resetAppOriginCache();
});
afterEach(() => {
  process.env = { ...ENV };
  __resetAppOriginCache();
});

describe('app origin', () => {
  it('allows localhost in development', () => {
    // VERCEL_ENV absent + non-production NODE_ENV under vitest.
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(appOrigin()).toBe('http://localhost:3000');
  });

  it('REFUSES localhost in production', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    // The whole point: never mail a client a link to their own machine.
    expect(() => appOrigin()).toThrow(/production/i);
  });

  it('refuses a missing origin in production', () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    expect(() => appOrigin()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it('refuses http in production', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'http://invoice.bankdemark.com';
    expect(() => appOrigin()).toThrow(/https/i);
  });

  it('normalises trailing slashes and adds https', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'invoice.bankdemark.com/';
    expect(appOrigin()).toBe('https://invoice.bankdemark.com');
  });

  it('builds share and app URLs from one origin', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'https://invoice.bankdemark.com';
    expect(appUrl('/pricing')).toBe('https://invoice.bankdemark.com/pricing');
    expect(appUrl('pricing')).toBe('https://invoice.bankdemark.com/pricing');
    expect(invoiceShareUrl('tok_abc')).toBe('https://invoice.bankdemark.com/i/tok_abc');
  });

  it('falls back to the Vercel preview URL', () => {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = 'bdm-git-branch.vercel.app';
    expect(appOrigin()).toBe('https://bdm-git-branch.vercel.app');
  });
});

describe('plans', () => {
  it('prices the four tiers in CAD as advertised', () => {
    expect(PLANS.free.priceMinor).toBe(0);
    expect(PLANS.starter.priceMinor).toBe(1200);
    expect(PLANS.pro.priceMinor).toBe(2400);
    expect(PLANS.business.priceMinor).toBe(4900);
    for (const id of PURCHASABLE_PLANS) {
      expect(PLANS[id].currency).toBe('CAD');
    }
    expect(formatPlanPrice(PLANS.starter)).toBe('$12');
    expect(formatPlanPrice(PLANS.free)).toBe('Free');
  });

  it('keeps Free genuinely limited so AI cost cannot run away', () => {
    expect(PLANS.free.limits.invoicesPerMonth).toBe(3);
    expect(PLANS.free.limits.activeClients).toBe(1);
    expect(PLANS.free.limits.aiActionsPerMonth).toBe(1);
    expect(PLANS.free.limits.logoBranding).toBe(false);
    expect(PLANS.free.limits.whiteLabel).toBe(false);
  });

  it('escalates limits monotonically up the tiers', () => {
    const order = ['free', 'starter', 'pro', 'business'] as const;
    const val = (v: number | null) => (v === null ? Infinity : v);
    for (let i = 1; i < order.length; i += 1) {
      const lower = PLANS[order[i - 1]].limits;
      const higher = PLANS[order[i]].limits;
      expect(val(higher.invoicesPerMonth)).toBeGreaterThanOrEqual(val(lower.invoicesPerMonth));
      expect(val(higher.aiActionsPerMonth)).toBeGreaterThanOrEqual(val(lower.aiActionsPerMonth));
      expect(val(higher.activeClients)).toBeGreaterThanOrEqual(val(lower.activeClients));
    }
  });

  it('gives the founder plan no limits and no price', () => {
    const f = PLANS.founder.limits;
    expect(PLANS.founder.priceMinor).toBeNull();
    expect(f.businesses).toBeNull();
    expect(f.invoicesPerMonth).toBeNull();
    expect(f.aiActionsPerMonth).toBeNull();
    expect(f.whiteLabel).toBe(true);
    // Not purchasable — it must never appear on the pricing page.
    expect(PURCHASABLE_PLANS).not.toContain('founder');
  });

  it('maps Stripe price ids back to plans, and rejects unknown ones', () => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter_123';
    process.env.STRIPE_PRICE_PRO = 'price_pro_456';
    expect(stripePriceId('starter')).toBe('price_starter_123');
    expect(planForPriceId('price_starter_123')).toBe('starter');
    expect(planForPriceId('price_pro_456')).toBe('pro');
    // An unrecognised price must never silently entitle anyone.
    expect(planForPriceId('price_someone_elses')).toBeNull();
    expect(planForPriceId(null)).toBeNull();
  });

  it('returns null for an unconfigured price rather than a placeholder', () => {
    delete process.env.STRIPE_PRICE_BUSINESS;
    expect(stripePriceId('business')).toBeNull();
    expect(stripePriceId('free')).toBeNull();
  });
});

describe('plan resolution falls back safely', () => {
  it('treats unknown or missing plans as Free, never as unlimited', async () => {
    const { planFor } = await import('../lib/config/plans');
    expect(planFor(undefined).id).toBe('free');
    expect(planFor(null).id).toBe('free');
    expect(planFor('nonsense').id).toBe('free');
    expect(planFor('enterprise').id).toBe('free');
  });
});

// ============================================================
// BUSINESS SERVICE
//
// One human may own many businesses. Their books never merge; only
// an explicit portfolio view aggregates across them, and it does so
// by summing already-isolated results rather than by querying across
// tenant boundaries.
// ============================================================

import 'server-only';
import { type AuthContext, type BusinessRole, requireUser } from './context';
import { checkBusinessLimit } from './access';
import { ServiceError, unwrap } from './errors';
import { recordAudit } from './audit';
import { checkQuota, planFor } from './entitlements';

export const BUSINESS_TYPES = [
  { id: 'travel',     label: 'Travel advisor or agency',   hint: 'You sell trips and earn commission from suppliers.' },
  { id: 'agency',     label: 'Agency or professional services', hint: 'You deliver projects or retainers for clients.' },
  { id: 'ecommerce',  label: 'Online store',                hint: 'You sell physical or digital products online.' },
  { id: 'saas',       label: 'Software or subscriptions',   hint: 'You charge recurring fees for a product.' },
  { id: 'freelancer', label: 'Freelancer or consultant',    hint: 'You invoice clients for your own time and work.' },
  { id: 'retail',     label: 'Retail or in-person',         hint: 'You sell from a location.' },
  { id: 'creator',    label: 'Creator or media',            hint: 'You earn from content, sponsorship or products.' },
  { id: 'holding',    label: 'Umbrella or holding company', hint: 'You run several brands or hold other businesses.' },
  { id: 'other',      label: 'Something else',              hint: 'We will keep it simple and general.' },
] as const;

export const REVENUE_MODELS = [
  { id: 'direct_sales',  label: 'Direct sales' },
  { id: 'services',      label: 'Services' },
  { id: 'commissions',   label: 'Commissions' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'projects',      label: 'Projects' },
  { id: 'marketplace',   label: 'Marketplace or pass-through' },
] as const;

export interface BusinessSummary {
  id: string;
  name: string;
  business_type: string;
  base_currency: string;
  country: string;
  is_personal: boolean;
  status: string;
  role: BusinessRole;
  created_at: string;
}

export async function listBusinesses(auth?: AuthContext): Promise<BusinessSummary[]> {
  const ctx = auth ?? (await requireUser());

  const rows = unwrap(
    await ctx.db
      .from('business_members')
      .select(
        'role, businesses!inner(id, name, business_type, base_currency, country, is_personal, status, created_at)'
      )
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: true }),
    'load your businesses'
  ) as unknown as Array<{ role: BusinessRole; businesses: Omit<BusinessSummary, 'role'> }>;

  return rows
    .filter((r) => r.businesses && r.businesses.status === 'active')
    .map((r) => ({ ...r.businesses, role: r.role }));
}

export interface CreateBusinessInput {
  name: string;
  businessType: string;
  revenueModel?: string[];
  country?: string;
  region?: string | null;
  baseCurrency?: string;
  fiscalYearStartMonth?: number;
  taxJurisdiction?: string | null;
  earnsCommissions?: boolean;
  handlesClientFunds?: boolean;
  isPersonal?: boolean;
  /**
   * 'none'   — one brand, one set of books.
   * 'brands' — several trade names inside ONE legal entity. One bank
   *            account, one tax return, one ledger segmented by brand.
   * 'group'  — each brand is its own legal entity with its own books
   *            and its own filing. Created as separate businesses.
   */
  brandModel?: 'none' | 'brands' | 'group';
  /** Brand names to create when brandModel is 'brands'. */
  brands?: string[];
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export async function createBusiness(
  input: CreateBusinessInput,
  auth?: AuthContext
): Promise<BusinessSummary> {
  const ctx = auth ?? (await requireUser());

  const name = input.name?.trim();
  if (!name || name.length > 120) {
    throw new ServiceError('validation', 'Enter a business name (up to 120 characters).');
  }
  if (!BUSINESS_TYPES.some((t) => t.id === input.businessType)) {
    throw new ServiceError('validation', 'Choose a business type.');
  }

  // Server-side plan limit. Founder accounts return unlimited.
  const limit = await checkBusinessLimit(ctx);
  if (!limit.allowed) {
    throw new ServiceError('forbidden', limit.reason ?? 'Business limit reached for your plan.');
  }

  const currency = (input.baseCurrency ?? 'CAD').toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    throw new ServiceError('validation', 'Currency must be a three-letter code, like CAD or USD.');
  }

  // Plan limit on number of businesses.
  const profile = unwrap(
    await ctx.db.from('profiles').select('plan').eq('id', ctx.userId).single(),
    'read your plan'
  ) as { plan: string | null };

  const existing = await listBusinesses(ctx);
  const quota = checkQuota(profile.plan, 'businesses', existing.length);
  if (!quota.allowed) {
    throw new ServiceError(
      'forbidden',
      `Your ${planFor(profile.plan).name} plan includes ${quota.limit} business${quota.limit === 1 ? '' : 'es'}. Upgrade to add another.`
    );
  }

  const business = unwrap(
    await ctx.db
      .from('businesses')
      .insert({
        owner_id: ctx.userId,
        name,
        business_type: input.businessType,
        revenue_model: input.revenueModel?.length ? input.revenueModel : ['direct_sales'],
        country: (input.country ?? 'CA').toUpperCase().slice(0, 2),
        region: input.region ?? null,
        base_currency: currency,
        fiscal_year_start_month: clampMonth(input.fiscalYearStartMonth ?? 1),
        tax_jurisdiction: input.taxJurisdiction ?? null,
        earns_commissions: input.earnsCommissions ?? input.businessType === 'travel',
        handles_client_funds: input.handlesClientFunds ?? false,
        is_personal: input.isPersonal ?? false,
        brand_model: input.brandModel ?? 'none',
      })
      .select('id, name, business_type, base_currency, country, is_personal, status, created_at')
      .single(),
    'create that business'
  ) as unknown as Omit<BusinessSummary, 'role'>;

  // Brands live inside this one set of books. Created here so a new
  // umbrella business is immediately segmentable.
  if (input.brandModel === 'brands' && input.brands?.length) {
    const rows = input.brands
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 25)
      .map((name, i) => ({
        business_id: business.id,
        name: name.slice(0, 120),
        slug: slugify(name) || `brand-${i + 1}`,
        sort_order: (i + 1) * 10,
      }));

    if (rows.length) {
      const { error } = await ctx.db.from('brands').insert(rows);
      if (error) {
        throw new ServiceError('internal', 'The business was created but its brands could not be saved.', {
          detail: error.message,
          cause: error,
        });
      }
    }
  }

  await recordAudit(ctx.db, {
    businessId: business.id,
    actorUserId: ctx.userId,
    actorType: 'user',
    entity: 'business',
    entityId: business.id,
    action: 'create',
    after: { ...business, brandModel: input.brandModel ?? 'none', brandCount: input.brands?.length ?? 0 },
    source: 'manual',
  });

  return { ...business, role: 'owner' };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

export async function listBrands(
  db: AuthContext['db'],
  businessId: string
): Promise<BrandRow[]> {
  const { data, error } = await db
    .from('brands')
    .select('id, name, slug, is_active, sort_order')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('sort_order');

  if (error) {
    throw new ServiceError('internal', 'Could not load brands.', { detail: error.message, cause: error });
  }
  return (data ?? []) as BrandRow[];
}

function clampMonth(m: number): number {
  return Math.min(Math.max(Math.round(m) || 1, 1), 12);
}

/**
 * Portfolio view across every business the user belongs to.
 *
 * Each business is summarised independently and only the presentation
 * aggregates. Records are never queried across tenants, and businesses
 * in different currencies are reported separately rather than summed.
 */
export async function getPortfolio(auth?: AuthContext) {
  const ctx = auth ?? (await requireUser());
  const businesses = await listBusinesses(ctx);

  const rows = await Promise.all(
    businesses.map(async (b) => {
      const { data, error } = await ctx.db
        .from('transactions')
        .select('amount_minor, recognized_amount_minor, transaction_kind, currency')
        .eq('business_id', b.id)
        .is('deleted_at', null)
        .limit(10_000);

      if (error) {
        return { business: b, error: 'Could not load this business', revenueMinor: 0, expensesMinor: 0, profitMinor: 0, cashMinor: 0 };
      }

      let revenue = 0;
      let expenses = 0;
      let cash = 0;
      for (const t of data ?? []) {
        cash += t.amount_minor;
        if (['income', 'commission', 'refund'].includes(t.transaction_kind)) {
          revenue += t.recognized_amount_minor ?? 0;
        } else if (['expense', 'reimbursement'].includes(t.transaction_kind)) {
          expenses += t.recognized_amount_minor ?? 0;
        }
      }

      return {
        business: b,
        error: null,
        revenueMinor: revenue,
        expensesMinor: expenses,
        profitMinor: revenue - expenses,
        cashMinor: cash,
      };
    })
  );

  // Group by currency: BankDeMark does not convert, so it does not pretend to.
  const byCurrency = new Map<string, { revenueMinor: number; expensesMinor: number; profitMinor: number; cashMinor: number; count: number }>();
  for (const row of rows) {
    const key = row.business.base_currency;
    const agg = byCurrency.get(key) ?? { revenueMinor: 0, expensesMinor: 0, profitMinor: 0, cashMinor: 0, count: 0 };
    agg.revenueMinor += row.revenueMinor;
    agg.expensesMinor += row.expensesMinor;
    agg.profitMinor += row.profitMinor;
    agg.cashMinor += row.cashMinor;
    agg.count += 1;
    byCurrency.set(key, agg);
  }

  return {
    businesses: rows,
    totalsByCurrency: [...byCurrency.entries()].map(([currency, t]) => ({ currency, ...t })),
  };
}

/** Sensible starting accounts so a new business is never a blank page. */
export async function seedStarterAccounts(
  ctx: AuthContext,
  businessId: string,
  currency: string,
  businessType: string
): Promise<void> {
  const accounts: Array<{ name: string; account_kind: string }> = [
    { name: 'Business chequing', account_kind: 'bank' },
    { name: 'Business credit card', account_kind: 'credit_card' },
  ];
  if (['retail', 'creator', 'freelancer'].includes(businessType)) {
    accounts.push({ name: 'Cash', account_kind: 'cash' });
  }

  const { error } = await ctx.db.from('accounts').insert(
    accounts.map((a) => ({
      business_id: businessId,
      name: a.name,
      account_kind: a.account_kind as never,
      currency,
      source: 'manual' as never,
      sync_status: 'manual',
    }))
  );

  if (error) {
    throw new ServiceError('internal', 'Could not set up starter accounts.', {
      detail: error.message,
      cause: error,
    });
  }
}

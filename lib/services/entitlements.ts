// ============================================================
// ENTITLEMENTS
//
// One table of what each plan actually grants, and one function that
// enforces it. No `if (plan === 'pro')` scattered through components.
//
// RULE, from the audit: a feature may not be advertised unless it is
// implemented AND enforced here. `advertised: false` means the
// capability exists in the schema but is not finished, so it must not
// appear on a pricing page. `PLAN_MARKETING` is the ONLY list a
// pricing surface may render.
//
// RULE: financial correctness is never gated. Every plan sees true
// numbers. Limits apply to scale and automation only.
// ============================================================

export type PlanId = 'free' | 'starter' | 'business' | 'pro' | 'founder';

export type Capability =
  | 'businesses'
  | 'connected_accounts'
  | 'transactions_per_month'
  | 'history_months'
  | 'ai_messages_per_month'
  | 'web_search'
  | 'ai_writes'
  | 'csv_import'
  | 'reports_core'
  | 'reports_advanced'
  | 'tax_workspace'
  | 'receipts'
  | 'accountant_seat'
  | 'team_seats'
  | 'mcp'
  | 'wealth_layer'
  | 'zylx_studio'
  | 'invoices_per_month'
  | 'invoice_send'
  | 'invoice_branding'
  | 'invoice_templates';

/** `true`/`false` for switches, a number for quotas, `null` for unlimited. */
export type Limit = boolean | number | null;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Minor units per month. null = not purchasable (legacy/internal). */
  monthlyPriceMinor: number | null;
  currency: string;
  limits: Record<Capability, Limit>;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceMinor: 0,
    currency: 'CAD',
    limits: {
      businesses: 1,
      connected_accounts: 0,
      transactions_per_month: 250,
      history_months: 3,
      ai_messages_per_month: 20,
      web_search: false,
      ai_writes: true,
      csv_import: true,
      reports_core: true,
      reports_advanced: false,
      tax_workspace: false,
      receipts: 10,
      accountant_seat: false,
      team_seats: 1,
      mcp: false,
      wealth_layer: false,
      zylx_studio: false,
      invoices_per_month: 5,
      invoice_send: true,
      invoice_branding: false,
      invoice_templates: false,
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyPriceMinor: 1900,
    currency: 'CAD',
    limits: {
      businesses: 1,
      connected_accounts: 2,
      transactions_per_month: 2000,
      history_months: 24,
      ai_messages_per_month: 300,
      web_search: true,
      ai_writes: true,
      csv_import: true,
      reports_core: true,
      reports_advanced: true,
      tax_workspace: true,
      receipts: 200,
      accountant_seat: false,
      team_seats: 2,
      mcp: false,
      wealth_layer: true,
      zylx_studio: true,
      invoices_per_month: 100,
      invoice_send: true,
      invoice_branding: true,
      invoice_templates: true,
    },
  },
  business: {
    id: 'business',
    name: 'Business',
    monthlyPriceMinor: 4900,
    currency: 'CAD',
    limits: {
      businesses: 5,
      connected_accounts: 10,
      transactions_per_month: null,
      history_months: null,
      ai_messages_per_month: null,
      web_search: true,
      ai_writes: true,
      csv_import: true,
      reports_core: true,
      reports_advanced: true,
      tax_workspace: true,
      receipts: null,
      accountant_seat: true,
      team_seats: 10,
      mcp: true,
      wealth_layer: true,
      zylx_studio: true,
      invoices_per_month: null,
      invoice_send: true,
      invoice_branding: true,
      invoice_templates: true,
    },
  },
  // Founder accounts. Every limit off. Granted only by the
  // `bdm_apply_founder_plan` trigger against public.founder_emails —
  // never settable by a user, since `plan` is revoked from them.
  founder: {
    id: 'founder',
    name: 'Founder',
    monthlyPriceMinor: null,
    currency: 'CAD',
    limits: {
      businesses: null,
      connected_accounts: null,
      transactions_per_month: null,
      history_months: null,
      ai_messages_per_month: null,
      web_search: true,
      ai_writes: true,
      csv_import: true,
      reports_core: true,
      reports_advanced: true,
      tax_workspace: true,
      receipts: null,
      accountant_seat: true,
      team_seats: null,
      mcp: true,
      wealth_layer: true,
      zylx_studio: true,
      invoices_per_month: null,
      invoice_send: true,
      invoice_branding: true,
      invoice_templates: true,
    },
  },
  // Legacy: anyone who bought the old "Pro" before entitlements existed.
  // Mapped to Business so nobody loses access.
  pro: {
    id: 'pro',
    name: 'Pro (legacy)',
    monthlyPriceMinor: null,
    currency: 'CAD',
    limits: {
      businesses: 5,
      connected_accounts: 10,
      transactions_per_month: null,
      history_months: null,
      ai_messages_per_month: null,
      web_search: true,
      ai_writes: true,
      csv_import: true,
      reports_core: true,
      reports_advanced: true,
      tax_workspace: true,
      receipts: null,
      accountant_seat: true,
      team_seats: 10,
      mcp: true,
      wealth_layer: true,
      zylx_studio: true,
      invoices_per_month: null,
      invoice_send: true,
      invoice_branding: true,
      invoice_templates: true,
    },
  },
};

export function planFor(plan: string | null | undefined): PlanDefinition {
  return PLANS[(plan ?? 'free') as PlanId] ?? PLANS.free;
}

export function limitFor(plan: string | null | undefined, capability: Capability): Limit {
  return planFor(plan).limits[capability];
}

export function isEnabled(plan: string | null | undefined, capability: Capability): boolean {
  const limit = limitFor(plan, capability);
  if (typeof limit === 'boolean') return limit;
  if (limit === null) return true;
  return limit > 0;
}

export interface QuotaCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  reason?: string;
}

export function checkQuota(
  plan: string | null | undefined,
  capability: Capability,
  used: number
): QuotaCheck {
  const limit = limitFor(plan, capability);

  if (limit === null) return { allowed: true, limit: null, used, remaining: null };
  if (typeof limit === 'boolean') {
    return limit
      ? { allowed: true, limit: null, used, remaining: null }
      : {
          allowed: false,
          limit: 0,
          used,
          remaining: 0,
          reason: `${CAPABILITY_LABELS[capability]} is not included in your plan.`,
        };
  }

  const remaining = Math.max(0, limit - used);
  return {
    allowed: used < limit,
    limit,
    used,
    remaining,
    reason:
      used >= limit
        ? `You have used all ${limit} of your ${CAPABILITY_LABELS[capability]} for this period.`
        : undefined,
  };
}

export const CAPABILITY_LABELS: Record<Capability, string> = {
  businesses: 'businesses',
  connected_accounts: 'connected accounts',
  transactions_per_month: 'transactions this month',
  history_months: 'months of history',
  ai_messages_per_month: 'Zylx messages this month',
  web_search: 'Web research',
  ai_writes: 'Zylx actions',
  csv_import: 'CSV import',
  reports_core: 'Core reports',
  reports_advanced: 'Advanced reports',
  tax_workspace: 'Tax workspace',
  receipts: 'receipts',
  accountant_seat: 'Accountant access',
  team_seats: 'team members',
  mcp: 'MCP / AI client access',
  wealth_layer: 'Wealth & investments',
  zylx_studio: 'Zylx Studio connection',
  invoices_per_month: 'invoices this month',
  invoice_send: 'Emailing invoices',
  invoice_branding: 'Invoice branding',
  invoice_templates: 'Invoice templates',
};

// ── Invoicing and the downgrade rule ────────────────────────
//
// `invoices_per_month` gates CREATING a new invoice. It never gates
// reading, exporting, re-downloading the PDF of, or recording payment
// against an invoice that already exists.
//
// A business that drops to Free keeps permanent access to every
// invoice it ever issued. Those are its own financial and tax records;
// withholding them behind a plan would be indefensible, and in most
// jurisdictions the business is legally required to retain them.
//
// Anything that reads or settles existing invoices must therefore
// never call `checkQuota`.

// ============================================================
// MARKETING SURFACE
//
// The ONLY list a pricing page may render. Every entry is backed by a
// capability that is enforced above and implemented in the product.
// Anything unfinished belongs in ROADMAP_NOT_SOLD, which pricing
// surfaces must render as "not yet available" or not at all.
// ============================================================

export interface MarketingFeature {
  capability: Capability;
  label: string;
  plans: PlanId[];
}

export const PLAN_MARKETING: MarketingFeature[] = [
  { capability: 'businesses', label: 'Separate books for each business', plans: ['free', 'starter', 'business'] },
  { capability: 'csv_import', label: 'CSV import with duplicate detection', plans: ['free', 'starter', 'business'] },
  { capability: 'reports_core', label: 'Profit & Loss and expense reports', plans: ['free', 'starter', 'business'] },
  { capability: 'ai_messages_per_month', label: 'Ask Zylx about your numbers', plans: ['free', 'starter', 'business'] },
  { capability: 'ai_writes', label: 'Zylx logs expenses for you (with approval)', plans: ['free', 'starter', 'business'] },
  { capability: 'reports_advanced', label: 'Cash flow, commissions, project profitability', plans: ['starter', 'business'] },
  { capability: 'web_search', label: 'Zylx researches current tax and finance questions', plans: ['starter', 'business'] },
  { capability: 'receipts', label: 'Receipt storage and matching', plans: ['starter', 'business'] },
  { capability: 'tax_workspace', label: 'Tax readiness workspace', plans: ['starter', 'business'] },
  { capability: 'wealth_layer', label: 'Personal wealth and net worth', plans: ['starter', 'business'] },
  { capability: 'accountant_seat', label: 'Give your accountant read access', plans: ['business'] },
  { capability: 'mcp', label: 'Connect Claude and other AI clients', plans: ['business'] },
  { capability: 'invoices_per_month', label: 'Create and send invoices', plans: ['free', 'starter', 'business'] },
  { capability: 'invoice_send', label: 'Email invoices with a PDF attached', plans: ['free', 'starter', 'business'] },
  { capability: 'invoice_templates', label: 'Invoice templates and accent colour', plans: ['starter', 'business'] },
  { capability: 'invoice_branding', label: 'Your branding only — remove the BankDeMark credit', plans: ['starter', 'business'] },
];

/**
 * Capabilities that are NOT finished and therefore must never appear on
 * a pricing page or in a checkout description.
 *
 * The audit found all eight of the previous "Pro Adds" were unenforced;
 * several did not exist at all. This list is the guard against that
 * happening again.
 */
export const ROADMAP_NOT_SOLD: string[] = [
  'Bank feed connections (schema and settings exist; no provider is connected)',
  'Receipt OCR and automatic matching (upload works; extraction does not)',
  'Automatic bank reconciliation',
  'Accountant year-end package export',
  'Balance sheet report',
  'Multi-currency conversion',
];

export function isSoldFeature(capability: Capability, plan: PlanId): boolean {
  return PLAN_MARKETING.some((f) => f.capability === capability && f.plans.includes(plan));
}

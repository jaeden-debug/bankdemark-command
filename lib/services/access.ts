// ============================================================
// ACCESS CONTROL — the one place a limit is decided
//
// Every gate in the product resolves here. There is exactly ONE
// founder-bypass check in the codebase (`isUnrestricted`), and it reads
// the plan the database assigned from the `founder_emails` allow-list —
// never an email comparison at a call site, never a client-supplied
// value.
//
// Two kinds of limit:
//   RESOURCE  — how many things exist now (businesses, active clients).
//               Counted live.
//   USAGE     — how many actions this month (invoices, AI drafts).
//               Metered by bdm_consume_usage, which reserves before it
//               decides so two concurrent requests cannot both pass.
// ============================================================

import 'server-only';
import type { AuthContext, BusinessContext, Db } from './context';
import { ServiceError, logError } from './errors';
import { planFor, type PlanDefinition, type PlanId } from '@/lib/config/plans';

export type UsageMetric = 'invoices' | 'ai_actions' | 'emails';

export interface Access {
  plan: PlanDefinition;
  /** Founder / bypass account: every limit off. */
  unrestricted: boolean;
}

/**
 * The user's effective plan.
 *
 * `profiles.plan` is not writable by users (revoked at the column level)
 * and is set to 'founder' by a SECURITY DEFINER trigger against the
 * allow-list, so trusting it here is safe.
 */
export async function getAccess(auth: AuthContext | BusinessContext): Promise<Access> {
  const { data, error } = await auth.db
    .from('profiles')
    .select('plan')
    .eq('id', auth.userId)
    .maybeSingle();

  if (error) {
    logError('access.plan_lookup_failed', error, { userId: auth.userId });
    // Fail closed: an unreadable plan is treated as Free, never as unlimited.
    return { plan: planFor('free'), unrestricted: false };
  }

  const plan = planFor(data?.plan);
  return { plan, unrestricted: plan.id === 'founder' };
}

/** The single bypass predicate. Nothing else may test for a founder. */
export function isUnrestricted(access: Access): boolean {
  return access.unrestricted;
}

// ── Boolean capabilities ────────────────────────────────────

export type Capability =
  | 'emailSending'
  | 'deliveryTracking'
  | 'logoBranding'
  | 'whiteLabel'
  | 'creditNotes'
  | 'advancedReporting'
  | 'prioritySupport';

export function can(access: Access, capability: Capability): boolean {
  if (access.unrestricted) return true;
  return access.plan.limits[capability] === true;
}

/** Throws a plan-appropriate 403 when the capability is not included. */
export function requireCapability(access: Access, capability: Capability, what: string): void {
  if (can(access, capability)) return;
  throw new ServiceError(
    'forbidden',
    `${what} is not included in the ${access.plan.name} plan.`
  );
}

// ── Resource limits (counted live) ──────────────────────────

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number | null;
  reason?: string;
}

/** How many businesses this user owns, against their plan. */
export async function checkBusinessLimit(auth: AuthContext): Promise<LimitCheck> {
  const access = await getAccess(auth);
  const limit = access.unrestricted ? null : access.plan.limits.businesses;

  const { count, error } = await auth.db
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', auth.userId)
    .eq('status', 'active');

  if (error) {
    logError('access.business_count_failed', error, { userId: auth.userId });
    throw new ServiceError('internal', 'Could not check your plan limits.');
  }

  const used = count ?? 0;
  if (limit === null) return { allowed: true, used, limit: null };

  return {
    allowed: used < limit,
    used,
    limit,
    reason:
      used >= limit
        ? `The ${access.plan.name} plan includes ${limit} ${limit === 1 ? 'business' : 'businesses'}. Upgrade to add another.`
        : undefined,
  };
}

/** Active clients in one business, against the plan. */
export async function checkClientLimit(ctx: BusinessContext): Promise<LimitCheck> {
  const access = await getAccess(ctx);
  const limit = access.unrestricted ? null : access.plan.limits.activeClients;

  const { count, error } = await ctx.db
    .from('counterparties')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .eq('is_active', true);

  if (error) {
    logError('access.client_count_failed', error, { businessId: ctx.businessId });
    throw new ServiceError('internal', 'Could not check your plan limits.');
  }

  const used = count ?? 0;
  if (limit === null) return { allowed: true, used, limit: null };

  return {
    allowed: used < limit,
    used,
    limit,
    reason:
      used >= limit
        ? `The ${access.plan.name} plan includes ${limit} active ${limit === 1 ? 'client' : 'clients'}. Upgrade or archive one.`
        : undefined,
  };
}

// ── Monthly usage (metered) ─────────────────────────────────

function limitForMetric(access: Access, metric: UsageMetric): number | null {
  if (access.unrestricted) return null;
  switch (metric) {
    case 'invoices':
      return access.plan.limits.invoicesPerMonth;
    case 'ai_actions':
      return access.plan.limits.aiActionsPerMonth;
    case 'emails':
      return null; // Email volume is governed by invoice count, not metered separately.
  }
}

/**
 * Reserve one unit of monthly usage.
 *
 * Reserves BEFORE returning, so concurrency cannot overshoot. If the
 * action then fails, call `releaseUsage` to give it back.
 */
export async function consumeUsage(
  ctx: BusinessContext,
  metric: UsageMetric,
  amount = 1
): Promise<LimitCheck> {
  const access = await getAccess(ctx);
  const limit = limitForMetric(access, metric);

  const { data, error } = await ctx.db.rpc('bdm_consume_usage', {
    p_business_id: ctx.businessId,
    p_metric: metric,
    // NULL is a valid argument meaning "unlimited"; the generated
    // signature does not model that, hence the cast.
    p_limit: limit as unknown as number,
    p_amount: amount,
  });

  if (error) {
    logError('access.consume_usage_failed', error, {
      businessId: ctx.businessId,
      metric,
    });
    throw new ServiceError('internal', 'Could not check your plan usage.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = Number(row?.used ?? 0);
  const allowed = Boolean(row?.allowed);

  return {
    allowed,
    used,
    limit,
    reason: allowed
      ? undefined
      : metric === 'ai_actions'
        ? `You have used all ${limit} Zylx invoice drafts included in the ${access.plan.name} plan this month.`
        : `You have used all ${limit} invoices included in the ${access.plan.name} plan this month.`,
  };
}

export async function releaseUsage(
  ctx: BusinessContext,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  const { error } = await ctx.db.rpc('bdm_release_usage', {
    p_business_id: ctx.businessId,
    p_metric: metric,
    p_amount: amount,
  });
  if (error) {
    logError('access.release_usage_failed', error, { businessId: ctx.businessId, metric });
  }
}

/** Current month's usage, for showing "3 of 50 used". Never a gate. */
export async function getUsageSummary(
  ctx: BusinessContext
): Promise<{ metric: UsageMetric; used: number; limit: number | null }[]> {
  const access = await getAccess(ctx);
  const period = new Date();
  const periodStart = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const { data } = await ctx.db
    .from('usage_counters')
    .select('metric, used')
    .eq('business_id', ctx.businessId)
    .eq('period', periodStart);

  const byMetric = new Map((data ?? []).map((r) => [r.metric as UsageMetric, Number(r.used)]));

  return (['invoices', 'ai_actions'] as UsageMetric[]).map((metric) => ({
    metric,
    used: byMetric.get(metric) ?? 0,
    limit: limitForMetric(access, metric),
  }));
}

/** Resolve the plan for a user id with an admin client (webhooks). */
export async function planForUser(db: Db, userId: string): Promise<PlanId> {
  const { data } = await db.from('profiles').select('plan').eq('id', userId).maybeSingle();
  return (data?.plan as PlanId) ?? 'free';
}

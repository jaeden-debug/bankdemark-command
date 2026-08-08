// ============================================================
// REQUEST CONTEXT
//
// Every service call resolves WHO is asking and WHICH business they
// are asking about, and verifies membership server-side. RLS is the
// backstop, not the only gate — an explicit check gives a clean 403
// instead of a confusing empty result.
// ============================================================

import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { ecosystemCookieOptions } from '@/lib/config/cookies';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { ServiceError } from './errors';
import type { Database } from '@/lib/db/database.types';

export type Db = SupabaseClient<Database>;

export type BusinessRole = 'viewer' | 'accountant' | 'member' | 'admin' | 'owner';

const ROLE_RANK: Record<BusinessRole, number> = {
  viewer: 10,
  accountant: 20,
  member: 30,
  admin: 40,
  owner: 50,
};

export function roleAtLeast(role: BusinessRole, min: BusinessRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** User-scoped client. All queries run under the caller's RLS. */
export function serverDb(): Db {
  const cookieStore = cookies();
  return createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, ecosystemCookieOptions(options as CookieOptions))
            );
          } catch {
            // Called from a Server Component; middleware refreshes the session.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. Bypasses RLS.
 *
 * Only for: Stripe webhooks, provider secret handling, summary
 * recomputation, and account deletion. Never reachable from a
 * user-supplied business id without an explicit membership check first.
 */
export function adminDb(): Db {
  return createSupabaseClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ServiceError('not_configured', `Server is missing configuration: ${name}`);
  }
  return value;
}

export interface AuthContext {
  db: Db;
  userId: string;
  email: string | null;
}

export async function requireUser(): Promise<AuthContext> {
  const db = serverDb();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) {
    throw new ServiceError('unauthenticated', 'Please sign in to continue.');
  }
  return { db, userId: data.user.id, email: data.user.email ?? null };
}

export interface BusinessContext extends AuthContext {
  businessId: string;
  role: BusinessRole;
  business: {
    id: string;
    name: string;
    business_type: string;
    base_currency: string;
    country: string;
    region: string | null;
    tax_jurisdiction: string | null;
    fiscal_year_start_month: number;
    accounting_basis: string;
    earns_commissions: boolean;
    handles_client_funds: boolean;
    timezone: string;
    is_personal: boolean;
  };
}

/**
 * Resolve and authorise a business for the current user.
 *
 * `minRole` is enforced here AND by RLS. Both must pass.
 */
export async function requireBusiness(
  businessId: string,
  minRole: BusinessRole = 'viewer'
): Promise<BusinessContext> {
  const auth = await requireUser();

  if (!isUuid(businessId)) {
    throw new ServiceError('validation', 'That business reference is not valid.');
  }

  const { data: membership, error: memberError } = await auth.db
    .from('business_members')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (memberError) {
    throw new ServiceError('internal', 'Could not verify your access to this business.', {
      detail: memberError.message,
      cause: memberError,
    });
  }
  if (!membership) {
    // Deliberately the same message as a permission failure so this
    // cannot be used to probe which business ids exist.
    throw new ServiceError('forbidden', 'You do not have access to this business.');
  }

  const role = membership.role as BusinessRole;
  if (!roleAtLeast(role, minRole)) {
    throw new ServiceError(
      'forbidden',
      `This action needs ${minRole} access. Your role is ${role}.`
    );
  }

  const { data: business, error: bizError } = await auth.db
    .from('businesses')
    .select(
      'id, name, business_type, base_currency, country, region, tax_jurisdiction, fiscal_year_start_month, accounting_basis, earns_commissions, handles_client_funds, timezone, is_personal'
    )
    .eq('id', businessId)
    .single();

  if (bizError || !business) {
    throw new ServiceError('not_found', 'That business could not be found.', {
      detail: bizError?.message,
    });
  }

  return { ...auth, businessId, role, business: business as BusinessContext['business'] };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

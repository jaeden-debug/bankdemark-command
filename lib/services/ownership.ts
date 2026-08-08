// ============================================================
// OWNERSHIP VALIDATION
//
// The model may name things. It may never establish that they belong to
// the caller's business. Every foreign entity id arriving from a client
// or a tool proposal passes through here first.
//
// The database enforces this too (trigger `bdm_assert_same_business`),
// so a forgotten call cannot create a cross-business reference. This
// layer exists to fail earlier and with a message a person can act on,
// and to cover entities the trigger does not reach.
// ============================================================

import 'server-only';
import { type BusinessContext, isUuid } from './context';
import { ServiceError } from './errors';

/** Tables that carry a `business_id` and can be referenced by a write. */
export type OwnedEntity =
  | 'accounts'
  | 'categories'
  | 'brands'
  | 'projects'
  | 'counterparties'
  | 'bookings'
  | 'documents'
  | 'invoices'
  | 'transactions';

const LABEL: Record<OwnedEntity, string> = {
  accounts: 'account',
  categories: 'category',
  brands: 'brand',
  projects: 'project',
  counterparties: 'client or vendor',
  bookings: 'booking',
  documents: 'document',
  invoices: 'invoice',
  transactions: 'transaction',
};

/** `categories` may be system-wide (business_id IS NULL) and shared by all. */
const SHARED_WHEN_NULL: ReadonlySet<OwnedEntity> = new Set<OwnedEntity>(['categories']);

/**
 * Verify a single id belongs to this business.
 *
 * Returns the id when valid so it can be used inline. Throws a
 * `validation` ServiceError otherwise — deliberately the same message
 * whether the row belongs to another business or does not exist, so
 * this cannot be used to probe which ids are real.
 */
export async function assertOwned(
  ctx: BusinessContext,
  entity: OwnedEntity,
  id: string | null | undefined
): Promise<string | null> {
  if (id === null || id === undefined || id === '') return null;

  if (!isUuid(id)) {
    throw new ServiceError('validation', `That ${LABEL[entity]} reference is not valid.`);
  }

  const { data, error } = await ctx.db
    .from(entity)
    .select('id, business_id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new ServiceError('internal', `Could not verify that ${LABEL[entity]}.`, {
      detail: error.message,
      cause: error,
    });
  }

  const businessId = (data as { business_id: string | null } | null)?.business_id;

  if (data && businessId === null && SHARED_WHEN_NULL.has(entity)) return id;
  if (data && businessId === ctx.businessId) return id;

  throw new ServiceError(
    'validation',
    `That ${LABEL[entity]} is not part of this business.`,
    { detail: `${entity} ${id} not owned by business ${ctx.businessId}` }
  );
}

/**
 * Verify several references at once. Runs in parallel and reports the
 * first failure, so a form with three bad ids does not require three
 * round trips to discover.
 */
export async function assertAllOwned(
  ctx: BusinessContext,
  refs: Partial<Record<OwnedEntity, string | null | undefined>>
): Promise<void> {
  const entries = Object.entries(refs) as Array<[OwnedEntity, string | null | undefined]>;
  await Promise.all(
    entries
      .filter(([, id]) => id !== null && id !== undefined && id !== '')
      .map(([entity, id]) => assertOwned(ctx, entity, id))
  );
}

/**
 * Verify a set of transaction ids all belong to this business, and
 * return them. Used before any bulk mutation so a proposal cannot smuggle
 * in a row from elsewhere among legitimate ones.
 */
export async function assertTransactionsOwned(
  ctx: BusinessContext,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) {
    throw new ServiceError('validation', 'No transactions were selected.');
  }
  if (ids.length > 500) {
    throw new ServiceError('validation', 'Change at most 500 transactions at a time.');
  }
  for (const id of ids) {
    if (!isUuid(id)) throw new ServiceError('validation', 'One of those transactions is not valid.');
  }

  const { data, error } = await ctx.db
    .from('transactions')
    .select('id')
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null)
    .in('id', ids as string[]);

  if (error) {
    throw new ServiceError('internal', 'Could not verify those transactions.', {
      detail: error.message,
      cause: error,
    });
  }

  const found = new Set((data ?? []).map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new ServiceError(
      'validation',
      missing.length === ids.length
        ? 'Those transactions are not part of this business.'
        : `${missing.length} of those transactions are not part of this business.`,
      { detail: `unowned: ${missing.slice(0, 5).join(', ')}` }
    );
  }

  return [...ids];
}

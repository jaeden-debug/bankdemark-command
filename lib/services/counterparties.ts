// ============================================================
// COUNTERPARTIES (clients, agencies, suppliers)
//
// One directory shared by invoices, bookings and transactions. There
// is deliberately no separate "invoice clients" table — the retired
// prototype's second customer list is exactly the duplication the
// kernel exists to prevent.
// ============================================================

import 'server-only';
import type { BusinessContext } from './context';
import { ServiceError, assertOk, unwrap, unwrapMaybe, logError } from './errors';
import { recordAudit, diffRecords, type ActorType, type DataSource } from './audit';
import { checkClientLimit } from './access';

export type CounterpartyKind = 'customer' | 'vendor' | 'supplier' | 'other';

export interface CounterpartyRow {
  id: string;
  name: string;
  kind: CounterpartyKind;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const COLUMNS = 'id, name, kind, email, phone, notes, is_active, created_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface WriteOptions {
  actorType?: ActorType;
  source?: DataSource;
  requestId?: string;
}

export async function listCounterparties(
  ctx: BusinessContext,
  options: { kind?: CounterpartyKind; includeArchived?: boolean } = {}
): Promise<CounterpartyRow[]> {
  let query = ctx.db
    .from('counterparties')
    .select(COLUMNS)
    .eq('business_id', ctx.businessId)
    .order('name');

  if (options.kind) query = query.eq('kind', options.kind);
  if (!options.includeArchived) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    throw new ServiceError('internal', 'Could not load your clients.', {
      detail: error.message,
      cause: error,
    });
  }
  return (data ?? []) as unknown as CounterpartyRow[];
}

export interface CounterpartyInput {
  name: string;
  kind?: CounterpartyKind;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

function validate(input: CounterpartyInput): {
  name: string;
  kind: CounterpartyKind;
  email: string | null;
  phone: string | null;
  notes: string | null;
} {
  const name = String(input.name ?? '').trim();
  if (!name) throw new ServiceError('validation', 'A name is required.');
  if (name.length > 200) throw new ServiceError('validation', 'That name is too long.');

  const kind = (input.kind ?? 'customer') as CounterpartyKind;
  if (!['customer', 'vendor', 'supplier', 'other'].includes(kind)) {
    throw new ServiceError('validation', `Unknown type: ${kind}`);
  }

  const email = input.email?.trim() || null;
  if (email && !EMAIL_RE.test(email)) {
    throw new ServiceError('validation', 'That email address is not valid.');
  }

  return {
    name,
    kind,
    email,
    phone: input.phone?.trim().slice(0, 50) || null,
    notes: input.notes?.slice(0, 2000) || null,
  };
}

export async function createCounterparty(
  ctx: BusinessContext,
  input: CounterpartyInput,
  options: WriteOptions = {}
): Promise<CounterpartyRow> {
  const clean = validate(input);

  // Same name, same type, already here — reuse it rather than creating
  // a duplicate the user then has to pick between on every invoice.
  const existing = unwrapMaybe(
    await ctx.db
      .from('counterparties')
      .select(COLUMNS)
      .eq('business_id', ctx.businessId)
      .eq('kind', clean.kind)
      .ilike('name', clean.name)
      .limit(1)
      .maybeSingle(),
    'check for an existing client'
  ) as CounterpartyRow | null;

  if (existing) {
    // Fill in contact details the existing record was missing.
    if ((clean.email && !existing.email) || (clean.phone && !existing.phone) || !existing.is_active) {
      return updateCounterparty(
        ctx,
        existing.id,
        {
          email: clean.email ?? existing.email,
          phone: clean.phone ?? existing.phone,
        },
        options,
        true
      );
    }
    return existing;
  }

  // Plan limit applies only to genuinely NEW clients — reactivating or
  // reusing an existing one above is not a new resource.
  const limit = await checkClientLimit(ctx);
  if (!limit.allowed) throw new ServiceError('forbidden', limit.reason ?? 'Client limit reached.');

  const row = unwrap(
    await ctx.db
      .from('counterparties')
      .insert({
        business_id: ctx.businessId,
        name: clean.name,
        kind: clean.kind,
        email: clean.email,
        phone: clean.phone,
        notes: clean.notes,
      })
      .select(COLUMNS)
      .single(),
    'save that client'
  ) as unknown as CounterpartyRow;

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'counterparty',
    entityId: row.id,
    action: 'create',
    after: row,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return row;
}

export async function updateCounterparty(
  ctx: BusinessContext,
  id: string,
  patch: Partial<CounterpartyInput> & { isActive?: boolean },
  options: WriteOptions = {},
  reactivate = false
): Promise<CounterpartyRow> {
  const before = unwrapMaybe(
    await ctx.db
      .from('counterparties')
      .select(COLUMNS)
      .eq('id', id)
      .eq('business_id', ctx.businessId)
      .maybeSingle(),
    'find that client'
  ) as CounterpartyRow | null;

  if (!before) throw new ServiceError('not_found', 'That client could not be found.');

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new ServiceError('validation', 'A name is required.');
    update.name = name.slice(0, 200);
  }
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.email !== undefined) {
    const email = patch.email?.trim() || null;
    if (email && !EMAIL_RE.test(email)) {
      throw new ServiceError('validation', 'That email address is not valid.');
    }
    update.email = email;
  }
  if (patch.phone !== undefined) update.phone = patch.phone?.trim().slice(0, 50) || null;
  if (patch.notes !== undefined) update.notes = patch.notes?.slice(0, 2000) || null;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (reactivate) update.is_active = true;

  if (Object.keys(update).length === 0) return before;

  const after = unwrap(
    await ctx.db
      .from('counterparties')
      .update(update as never)
      .eq('id', id)
      .eq('business_id', ctx.businessId)
      .select(COLUMNS)
      .single(),
    'save that client'
  ) as unknown as CounterpartyRow;

  const delta = diffRecords(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>
  );
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'counterparty',
    entityId: id,
    action: 'update',
    before: delta.before,
    after: delta.after,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return after;
}

/**
 * Archive rather than delete.
 *
 * `invoices.counterparty_id` is ON DELETE RESTRICT precisely so a
 * historical invoice can never lose its "Bill To". Archiving hides the
 * client from pickers while every document that names them stays intact.
 */
export async function archiveCounterparty(
  ctx: BusinessContext,
  id: string,
  options: WriteOptions = {}
): Promise<void> {
  assertOk(
    await ctx.db
      .from('counterparties')
      .update({ is_active: false })
      .eq('id', id)
      .eq('business_id', ctx.businessId),
    'archive that client'
  );

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'counterparty',
    entityId: id,
    action: 'archive',
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });
}

/** Per-client invoice totals, for the directory. Currency-grouped. */
export async function counterpartyInvoiceStats(
  ctx: BusinessContext
): Promise<Map<string, { currency: string; billedMinor: number; outstandingMinor: number; count: number }>> {
  const { data, error } = await ctx.db
    .from('invoices')
    .select('counterparty_id, currency, total_minor, balance_minor, status')
    .eq('business_id', ctx.businessId)
    .not('counterparty_id', 'is', null)
    .neq('status', 'draft')
    .neq('status', 'void');

  const out = new Map<string, { currency: string; billedMinor: number; outstandingMinor: number; count: number }>();
  if (error) {
    logError('counterparty.stats_failed', error, { businessId: ctx.businessId });
    return out;
  }

  for (const row of data ?? []) {
    const key = row.counterparty_id as string;
    const prev = out.get(key);
    if (prev && prev.currency !== row.currency) {
      // Mixed currencies for one client: never add them together.
      // The directory shows the count only in that case.
      out.set(key, { ...prev, billedMinor: -1, outstandingMinor: -1, count: prev.count + 1 });
      continue;
    }
    out.set(key, {
      currency: row.currency,
      billedMinor: (prev?.billedMinor ?? 0) + Number(row.total_minor),
      outstandingMinor: (prev?.outstandingMinor ?? 0) + Number(row.balance_minor),
      count: (prev?.count ?? 0) + 1,
    });
  }
  return out;
}

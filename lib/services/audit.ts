// ============================================================
// AUDIT TRAIL
//
// Every financial write records who did it, when, from what, to what,
// and through which surface (user / Zylx / MCP / import / integration).
//
// This is what makes an accountant able to trust the books and makes
// "why did this number change?" answerable.
// ============================================================

import 'server-only';
import type { Db } from './context';
import { logError } from './errors';

export type ActorType = 'user' | 'zylx' | 'mcp' | 'system' | 'import' | 'integration' | 'stripe';
export type DataSource =
  | 'manual' | 'csv' | 'zylx' | 'mcp' | 'stripe' | 'shopify'
  | 'paypal' | 'square' | 'bank_feed' | 'system';

export interface AuditEntry {
  businessId: string | null;
  actorUserId?: string | null;
  actorType?: ActorType;
  entity: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  source?: DataSource;
  requestId?: string | null;
}

/**
 * Append to the audit log.
 *
 * Never throws: a failure to journal must not roll back a legitimate
 * financial write the user already saw succeed. It IS logged loudly so
 * the gap is visible in observability rather than silent.
 */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  const { error } = await db.from('audit_log').insert({
    business_id: entry.businessId,
    actor_user_id: entry.actorUserId ?? null,
    actor_type: entry.actorType ?? 'user',
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    before: entry.before ? (sanitise(entry.before) as never) : null,
    after: entry.after ? (sanitise(entry.after) as never) : null,
    source: entry.source ?? 'manual',
    request_id: entry.requestId ?? null,
  });

  if (error) {
    logError('audit.write_failed', error, {
      businessId: entry.businessId ?? undefined,
      entity: entry.entity,
      action: entry.action,
    });
  }
}

/** Diff two records down to only what actually changed. */
export function diffRecords<T extends Record<string, unknown>>(
  before: T | null,
  after: T | null
): { before: Partial<T>; after: Partial<T> } {
  if (!before) return { before: {}, after: after ?? {} };
  if (!after) return { before, after: {} };

  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key as keyof T] = before[key as keyof T];
      a[key as keyof T] = after[key as keyof T];
    }
  }
  return { before: b, after: a };
}

const SECRET_KEY = /key|secret|token|password|credential|ciphertext/i;

function sanitise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitise);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitise(v);
  }
  return out;
}

export interface AuditRow {
  id: number;
  actor_user_id: string | null;
  actor_type: string;
  entity: string;
  entity_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  source: string;
  created_at: string;
}

export async function listAudit(
  db: Db,
  businessId: string,
  options: { entity?: string; entityId?: string; limit?: number } = {}
): Promise<AuditRow[]> {
  let query = db
    .from('audit_log')
    .select('id, actor_user_id, actor_type, entity, entity_id, action, before, after, source, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? 100, 500));

  if (options.entity) query = query.eq('entity', options.entity);
  if (options.entityId) query = query.eq('entity_id', options.entityId);

  const { data, error } = await query;
  if (error) {
    logError('audit.list_failed', error, { businessId });
    return [];
  }
  return (data ?? []) as AuditRow[];
}

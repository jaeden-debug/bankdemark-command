// ============================================================
// SERVICE ERRORS
//
// The 2026-08-07 audit found four features silently broken in
// production for weeks. Every one was hidden by a discarded `await`
// or a bare `catch {}`. This module exists so that never happens
// again: a failed database call becomes a typed, logged, surfaced
// error — never an empty array that looks like "no data yet".
// ============================================================

import type { PostgrestError } from '@supabase/supabase-js';

export type ServiceErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'not_configured'
  | 'upstream'
  | 'internal';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly cause?: unknown;

  constructor(
    code: ServiceErrorCode,
    message: string,
    options: { status?: number; detail?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.detail = options.detail;
    this.cause = options.cause;
  }

  toJSON() {
    return { error: this.message, code: this.code, detail: this.detail };
  }
}

function defaultStatus(code: ServiceErrorCode): number {
  switch (code) {
    case 'unauthenticated': return 401;
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'validation': return 400;
    case 'conflict': return 409;
    case 'rate_limited': return 429;
    case 'not_configured': return 503;
    case 'upstream': return 502;
    default: return 500;
  }
}

/**
 * Unwrap a Supabase result. Throws on error rather than returning null.
 *
 * Usage:
 *   const rows = unwrap(await supabase.from('transactions').select('*'), 'load transactions');
 */
export function unwrap<T>(
  result: { data: T | null; error: PostgrestError | null },
  context: string
): T {
  if (result.error) throw fromPostgrest(result.error, context);
  if (result.data === null) {
    throw new ServiceError('not_found', `${context}: no data returned`);
  }
  return result.data;
}

/** Like `unwrap`, but a missing row is a legitimate `null` rather than an error. */
export function unwrapMaybe<T>(
  result: { data: T | null; error: PostgrestError | null },
  context: string
): T | null {
  if (result.error) {
    // PGRST116 = "no rows returned" from .single(); that is not a failure.
    if (result.error.code === 'PGRST116') return null;
    throw fromPostgrest(result.error, context);
  }
  return result.data;
}

/** For writes where we only care that it succeeded. */
export function assertOk(
  result: { error: PostgrestError | null },
  context: string
): void {
  if (result.error) throw fromPostgrest(result.error, context);
}

export function fromPostgrest(error: PostgrestError, context: string): ServiceError {
  const detail = [error.code, error.details, error.hint].filter(Boolean).join(' · ');

  // 42501 insufficient_privilege / RLS denial
  if (error.code === '42501' || error.message?.includes('row-level security')) {
    return new ServiceError('forbidden', `You do not have access to this data.`, {
      detail: `${context}: ${detail}`,
      cause: error,
    });
  }
  // 23505 unique_violation
  if (error.code === '23505') {
    return new ServiceError('conflict', `That record already exists.`, {
      detail: `${context}: ${detail}`,
      cause: error,
    });
  }
  // 23503 foreign_key_violation, 23514 check_violation, 22P02 invalid_text_representation
  if (['23503', '23514', '22P02'].includes(error.code ?? '')) {
    return new ServiceError('validation', `That value is not valid: ${error.message}`, {
      detail: `${context}: ${detail}`,
      cause: error,
    });
  }
  // 42703 undefined_column — the exact class of bug that hid for weeks.
  if (error.code === '42703' || error.code === '42P01') {
    return new ServiceError(
      'internal',
      `BankDeMark's database is out of sync with the app. This has been logged.`,
      { detail: `${context}: SCHEMA DRIFT — ${error.message}`, cause: error }
    );
  }

  return new ServiceError('internal', `Could not ${context}.`, {
    detail: `${context}: ${error.message} ${detail}`,
    cause: error,
  });
}

// ── Structured logging ──────────────────────────────────────

export interface LogContext {
  requestId?: string;
  userId?: string;
  businessId?: string;
  route?: string;
  [key: string]: unknown;
}

/**
 * Structured, greppable logs. Deliberately never logs values from
 * `provider_secrets`, request bodies, or anything under a key matching
 * /key|secret|token|password|credential/i.
 */
export function logError(event: string, error: unknown, context: LogContext = {}): void {
  const payload = {
    level: 'error',
    event,
    at: new Date().toISOString(),
    ...redact(context),
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof ServiceError ? error.code : undefined,
    detail: error instanceof ServiceError ? error.detail : undefined,
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
  };
  console.error(JSON.stringify(payload));
}

export function logEvent(event: string, context: LogContext = {}): void {
  console.log(JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...redact(context) }));
}

const SECRET_KEY = /key|secret|token|password|credential|authorization|cookie/i;

function redact(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
  }
  return out;
}

/** Convert anything thrown into a ServiceError for a route response. */
export function toServiceError(error: unknown, fallbackContext: string): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return fromPostgrest(error as PostgrestError, fallbackContext);
  }
  return new ServiceError('internal', `Could not ${fallbackContext}.`, { cause: error });
}

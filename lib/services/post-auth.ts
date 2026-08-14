// ============================================================
// POST-AUTH DESTINATION — COMMAND
//
// One resolver per product, in one place. Invoice has the same file and
// the same shape (lib/services/post-auth.ts over there); the two differ
// only in where they land a user and which prefixes they treat as
// foreign. Keeping them symmetrical means a change of policy in one is
// obvious when read against the other.
//
// Before this existed, Command's auth callback and its /command entry
// both hard-coded '/command/portfolio'. That is a real page — the
// business selector — but sending every authenticated user there means
// somebody with exactly one business gets a list of one thing to click
// before they can see anything. The resolver removes that hop without
// removing the selector for the people it is actually for.
// ============================================================

import 'server-only';
import { requireUser } from './context';
import { listBusinesses } from './businesses';

/** Only BankDeMark-controlled relative paths are ever accepted. */
const SAFE_PATH = /^\/[A-Za-z0-9/_-]*$/;

/**
 * Route prefixes that belong to a DIFFERENT BankDeMark product.
 *
 * Identity is shared across *.bankdemark.com, so a `next` value minted
 * on one product's domain can arrive at the other's callback. Invoice
 * rejects '/command' for the same reason this list exists: on the wrong
 * host those paths are a 404, and a redirect into a 404 after a
 * successful sign-in reads to the user as a failed sign-in.
 *
 * Command serves /b/, /onboarding, /pricing and /command itself, so
 * there is currently no Invoice-only prefix to name here. The list is
 * kept rather than removed: it is the place this check belongs when
 * Invoice grows a route Command does not have.
 */
const FOREIGN_PREFIXES: string[] = [];

export function safeInternalPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  // Reject absolute URLs, protocol-relative URLs and anything with a host.
  if (!SAFE_PATH.test(next)) return fallback;
  if (next.startsWith('//')) return fallback;
  if (FOREIGN_PREFIXES.some((p) => next === p || next.startsWith(`${p}/`))) return fallback;
  return next;
}

/**
 * Where an authenticated Command user belongs.
 *
 *   no business   -> /onboarding            create the first one
 *   one business  -> that business's dashboard
 *   several       -> /command/portfolio     the selector, which is the
 *                                           point when there is a choice
 *
 * Deliberately NOT any of the /command/* personal-finance screens
 * (wealth, debt, goals, affordability, marketplace, profile). Those are
 * pre-rebuild routes retained for a later phase; they are noindex, they
 * are disallowed in robots.txt, and nothing in the current product links
 * to them. Authentication must not be the thing that puts a user inside
 * them.
 */
export async function resolveCommandDestination(): Promise<string> {
  const auth = await requireUser();
  const businesses = await listBusinesses(auth);

  if (businesses.length === 0) return '/onboarding';
  if (businesses.length === 1) return `/b/${businesses[0].id}/dashboard`;
  return '/command/portfolio';
}

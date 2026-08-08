// ============================================================
// RECEIPT ↔ TRANSACTION MATCHING
//
// Deciding whether a receipt is already in the books is a financial
// judgement, so it is made HERE — deterministically, with an explainable
// score — not by the model. Zylx explains the result; it does not
// produce it.
//
// Pure functions. No I/O, no LLM.
// ============================================================

import type { LedgerTransaction } from './ledger';

export interface MatchCandidate {
  transactionId: string;
  score: number;
  /** Plain-language reasons, shown to the user rather than a bare score. */
  reasons: string[];
  /** ≥0.85 and unambiguous — safe to offer as "this is already recorded". */
  confident: boolean;
}

export interface MatchInput {
  amountMinor: number | null;
  date: string | null;
  vendor: string | null;
}

/** Words that carry no signal when comparing merchant names. */
const NOISE = new Set([
  'inc', 'llc', 'ltd', 'corp', 'co', 'company', 'the', 'and',
  'store', 'shop', 'pos', 'purchase', 'payment', 'card', 'debit', 'credit',
]);

/**
 * Reduce a merchant string to comparable tokens.
 *
 * Bank descriptions are noisy — "SQ *BLUE BOTTLE 4821 TORONTO ON" and a
 * receipt saying "Blue Bottle Coffee" are the same merchant. Stripping
 * processor prefixes, digits and locations is what makes them meet.
 */
export function normalizeMerchant(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    // Processor prefixes: SQ*, TST*, SP *, PAYPAL *
    .replace(/\b(sq|tst|sp|py|paypal|pp|amzn|amazon mktp)\s*\*?\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !NOISE.has(t));
}

function merchantOverlap(a: string | null, b: string | null): number {
  const left = normalizeMerchant(a);
  const right = normalizeMerchant(b);
  if (left.length === 0 || right.length === 0) return 0;

  const rightSet = new Set(right);
  const shared = left.filter((t) => rightSet.has(t)).length;
  return shared / Math.min(left.length, right.length);
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Number.isNaN(ms) ? Infinity : Math.round(ms / 86_400_000);
}

/**
 * Score how likely a receipt is to already be recorded.
 *
 * Amount is weighted highest because it is the least ambiguous signal a
 * receipt carries. Date and merchant refine it. A match on merchant
 * alone is deliberately never enough — the same shop visited twice is
 * two transactions, not a duplicate.
 */
export function scoreMatch(receipt: MatchInput, tx: LedgerTransaction): MatchCandidate {
  const reasons: string[] = [];
  let score = 0;

  // ── Amount (0.55) ─────────────────────────────────────────
  if (receipt.amountMinor !== null) {
    const txAbs = Math.abs(tx.amount_minor);
    const rcAbs = Math.abs(receipt.amountMinor);
    const diff = Math.abs(txAbs - rcAbs);

    if (diff === 0) {
      score += 0.55;
      reasons.push('the amount matches exactly');
    } else if (diff <= 2) {
      score += 0.5;
      reasons.push('the amount matches within a cent or two');
    } else if (rcAbs > 0 && diff / rcAbs <= 0.02) {
      // A tip added after the receipt printed is the common case.
      score += 0.3;
      reasons.push('the amount is within 2% — a tip may have been added');
    } else {
      // A clear amount mismatch is strong evidence AGAINST.
      score -= 0.3;
    }
  }

  // ── Date (0.30) ───────────────────────────────────────────
  if (receipt.date) {
    const gap = daysBetween(receipt.date, tx.occurred_on);
    if (gap === 0) {
      score += 0.3;
      reasons.push('same day');
    } else if (gap <= 2) {
      score += 0.22;
      reasons.push(`${gap} day${gap === 1 ? '' : 's'} apart — cards often post late`);
    } else if (gap <= 5) {
      score += 0.1;
      reasons.push(`${gap} days apart`);
    } else if (gap > 30) {
      score -= 0.25;
    }
  }

  // ── Merchant (0.15) ───────────────────────────────────────
  const overlap = merchantOverlap(receipt.vendor, tx.merchant ?? tx.description ?? null);
  if (overlap >= 0.8) {
    score += 0.15;
    reasons.push('the merchant name matches');
  } else if (overlap >= 0.4) {
    score += 0.08;
    reasons.push('the merchant name is similar');
  }

  const clamped = Math.max(0, Math.min(1, score));

  return {
    transactionId: tx.id,
    score: clamped,
    reasons,
    // Confidence requires the amount to line up. Date and merchant alone
    // can coincide; an exact amount rarely does.
    confident:
      clamped >= 0.85 &&
      receipt.amountMinor !== null &&
      Math.abs(Math.abs(tx.amount_minor) - Math.abs(receipt.amountMinor)) <= 2,
  };
}

export interface MatchResult {
  /** Best candidates, strongest first. Never more than 5. */
  candidates: MatchCandidate[];
  /** Set only when one candidate is both confident AND clearly ahead. */
  likelyDuplicate: MatchCandidate | null;
}

/**
 * Find transactions this receipt may already correspond to.
 *
 * A single confident candidate is reported as a likely duplicate. Two
 * near-identical candidates deliberately are NOT — a business that
 * charges the same amount twice in a day is exactly when a wrong
 * automatic match does real damage.
 */
export function findMatches(
  receipt: MatchInput,
  transactions: readonly LedgerTransaction[],
  options: { minScore?: number } = {}
): MatchResult {
  const minScore = options.minScore ?? 0.45;

  const scored = transactions
    .filter((t) => !t.deleted_at)
    .map((t) => scoreMatch(receipt, t))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const best = scored[0];
  const runnerUp = scored[1];

  const ambiguous = Boolean(best && runnerUp && best.score - runnerUp.score < 0.12);

  return {
    candidates: scored,
    likelyDuplicate: best?.confident && !ambiguous ? best : null,
  };
}

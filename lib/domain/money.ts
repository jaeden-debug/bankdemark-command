// ============================================================
// MONEY
//
// All monetary values in BankDeMark are integers in MINOR UNITS
// (cents for CAD/USD). Binary floating point is never used for an
// authoritative total.
//
//   $6,000.00  ->  600000
//   $600.00    ->   60000
//   $0.01      ->       1
//
// Number.MAX_SAFE_INTEGER is 9,007,199,254,740,991 minor units,
// i.e. ~$90 trillion. Every total is exact well past any realistic
// business, and `assertSafeMinor` fails loudly rather than silently
// losing precision if that is ever exceeded.
// ============================================================

export type CurrencyCode = string; // ISO-4217, e.g. 'CAD'

export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

/** Currencies whose minor unit is not 1/100. */
const EXPONENT_OVERRIDES: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export function minorUnitExponent(currency: CurrencyCode): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

export function minorUnitsPerMajor(currency: CurrencyCode): number {
  return 10 ** minorUnitExponent(currency);
}

export class MoneyPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyPrecisionError';
  }
}

export function assertSafeMinor(minor: number, context = 'money'): number {
  if (!Number.isFinite(minor)) {
    throw new MoneyPrecisionError(`${context}: value is not finite (${minor})`);
  }
  if (!Number.isInteger(minor)) {
    throw new MoneyPrecisionError(`${context}: minor units must be an integer, got ${minor}`);
  }
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyPrecisionError(`${context}: value exceeds exact integer range (${minor})`);
  }
  return minor;
}

export function money(minor: number, currency: CurrencyCode): Money {
  return { minor: assertSafeMinor(minor, `money(${currency})`), currency };
}

export function zero(currency: CurrencyCode): Money {
  return { minor: 0, currency };
}

/**
 * Parse a human-entered major-unit amount into exact minor units.
 *
 * Uses string arithmetic rather than `Math.round(value * 100)` because
 * the latter is wrong for values like 1.005 and 8.165 that have no exact
 * binary representation. Accepts "1,234.56", "$1234.56", "(12.34)" and
 * "-12.34".
 */
export function parseMajorToMinor(input: string | number, currency: CurrencyCode): number {
  const exponent = minorUnitExponent(currency);

  let raw = typeof input === 'number' ? numberToPlainString(input) : String(input);
  raw = raw.trim();
  if (raw === '') throw new MoneyPrecisionError('empty amount');

  // Accounting negatives: (12.34)
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }

  raw = raw.replace(/[\s,'  ]/g, '').replace(/[^\d.\-+]/g, '');

  if (raw.startsWith('-')) {
    negative = !negative;
    raw = raw.slice(1);
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1);
  }

  if (raw === '' || !/^\d*(\.\d*)?$/.test(raw)) {
    throw new MoneyPrecisionError(`cannot parse amount: ${String(input)}`);
  }

  const [whole = '0', fractionRaw = ''] = raw.split('.');

  // Round half-away-from-zero on the first dropped digit, done on the
  // digit string so no float is ever involved.
  let fraction = fractionRaw.slice(0, exponent).padEnd(exponent, '0');
  const nextDigit = fractionRaw.charAt(exponent);
  let minor = Number(`${whole || '0'}${fraction}`);
  if (nextDigit && Number(nextDigit) >= 5) minor += 1;

  assertSafeMinor(minor, 'parseMajorToMinor');
  return negative ? -minor : minor;
}

/** Avoid scientific notation from very small/large numbers. */
function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new MoneyPrecisionError(`not finite: ${n}`);
  if (Math.abs(n) < 1e21 && !String(n).includes('e')) return String(n);
  return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

export function minorToMajor(minor: number, currency: CurrencyCode): number {
  return minor / minorUnitsPerMajor(currency);
}

export function addMoney(a: Money, b: Money): Money {
  requireSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  requireSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += assertSafeMinor(v, 'sumMinor');
  return assertSafeMinor(total, 'sumMinor total');
}

/**
 * Multiply minor units by a rate (e.g. a commission percentage).
 * Rounds half-away-from-zero to whole minor units — never leaves
 * fractional cents in the ledger.
 */
export function applyRate(minor: number, rate: number): number {
  assertSafeMinor(minor, 'applyRate');
  if (!Number.isFinite(rate)) throw new MoneyPrecisionError(`rate is not finite: ${rate}`);
  const exact = minor * rate;
  const rounded = exact < 0 ? -Math.round(-exact) : Math.round(exact);
  return assertSafeMinor(rounded, 'applyRate result');
}

function requireSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyPrecisionError(
      `currency mismatch: ${a.currency} vs ${b.currency}. BankDeMark does not silently convert currencies.`
    );
  }
}

// ── Formatting ──────────────────────────────────────────────

export interface FormatMoneyOptions {
  /** Show cents. Defaults to false for whole-dollar dashboard figures. */
  showMinor?: boolean;
  /** Render as "+$1,200" / "-$1,200" rather than "$1,200" / "-$1,200". */
  signDisplay?: 'auto' | 'always' | 'never';
  locale?: string;
}

export function formatMinor(
  minor: number,
  currency: CurrencyCode,
  options: FormatMoneyOptions = {}
): string {
  const { showMinor = false, signDisplay = 'auto', locale = 'en-CA' } = options;
  const exponent = minorUnitExponent(currency);
  const value = minor / 10 ** exponent;
  const digits = showMinor ? exponent : 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signDisplay === 'never' ? 'never' : signDisplay === 'always' ? 'always' : 'auto',
  }).format(signDisplay === 'never' ? Math.abs(value) : value);
}

export function formatMoney(m: Money, options: FormatMoneyOptions = {}): string {
  return formatMinor(m.minor, m.currency, options);
}

/** Compact form for chart axes and tight cards: $1.2K, $3.4M. */
export function formatMinorCompact(minor: number, currency: CurrencyCode, locale = 'en-CA'): string {
  const value = minor / minorUnitsPerMajor(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Percentage change between two minor-unit values, or null when undefined. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

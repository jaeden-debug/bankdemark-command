// ============================================================
// CSV PARSING & COLUMN DETECTION
//
// Pure functions, no I/O. Bank exports are wildly inconsistent, so
// this does the guessing that would otherwise be the owner's job:
// it finds the header row, works out which columns hold the date,
// amount and description, and detects whether debits and credits are
// in one signed column or two.
//
// The one thing it will NOT guess is an ambiguous date order. 03/04
// is either 3 April or 4 March, and picking wrong silently shifts a
// year of reporting. When the data cannot settle it, we ask.
// ============================================================

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** RFC 4180-ish parser: quoted fields, embedded commas/newlines, escaped quotes. */
export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  // Strip BOM — Excel exports carry it and it corrupts the first header.
  const text = input.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delim) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  if (rows.length === 0) return { headers: [], rows: [] };

  // Some banks put a title or account summary above the real header.
  const headerIndex = findHeaderRow(rows);
  return {
    headers: rows[headerIndex].map((h) => h.trim()),
    rows: rows.slice(headerIndex + 1),
  };
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (const char of sample) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

/** The header is the first row that looks like labels rather than data. */
function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i].map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const looksLikeData = cells.filter((c) => looksNumeric(c) || looksLikeDate(c)).length;
    if (looksLikeData / cells.length < 0.4) return i;
  }
  return 0;
}

function looksNumeric(value: string): boolean {
  return /^[-+(]?[$€£]?\s*[\d,\s]+(\.\d+)?\)?$/.test(value.trim()) && /\d/.test(value);
}

function looksLikeDate(value: string): boolean {
  return parseDateLoose(value.trim(), 'unknown') !== null;
}

// ── Column detection ────────────────────────────────────────

export type ColumnRole = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'ignore';

const PATTERNS: Array<{ role: ColumnRole; test: RegExp; weight: number }> = [
  { role: 'date', test: /^(transaction\s*)?date$|posted|date$/i, weight: 10 },
  { role: 'date', test: /date/i, weight: 5 },
  { role: 'description', test: /^(description|details|narrative|memo|payee|merchant|name|particulars)$/i, weight: 10 },
  { role: 'description', test: /descr|detail|memo|payee|merchant|narrat/i, weight: 5 },
  { role: 'debit', test: /^(debit|withdrawal|money\s*out|paid\s*out|charges?)$/i, weight: 10 },
  { role: 'debit', test: /debit|withdraw|money out|paid out/i, weight: 5 },
  { role: 'credit', test: /^(credit|deposit|money\s*in|paid\s*in)$/i, weight: 10 },
  { role: 'credit', test: /credit|deposit|money in|paid in/i, weight: 5 },
  { role: 'balance', test: /balance/i, weight: 10 },
  { role: 'amount', test: /^(amount|value|sum|total)$/i, weight: 10 },
  { role: 'amount', test: /amount|value/i, weight: 5 },
];

export interface ColumnMapping {
  date: number | null;
  description: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** True when debits and credits arrive in two separate columns. */
  splitColumns: boolean;
}

export function detectColumns(parsed: ParsedCsv): ColumnMapping {
  const scores = new Map<ColumnRole, { index: number; score: number }>();

  parsed.headers.forEach((header, index) => {
    for (const p of PATTERNS) {
      if (!p.test.test(header)) continue;
      // Balance columns must never be mistaken for the amount.
      const current = scores.get(p.role);
      if (!current || p.weight > current.score) scores.set(p.role, { index, score: p.weight });
    }
  });

  const pick = (role: ColumnRole) => scores.get(role)?.index ?? null;

  let date = pick('date');
  let description = pick('description');
  let amount = pick('amount');
  const debit = pick('debit');
  const credit = pick('credit');
  const balance = pick('balance');

  if (amount !== null && amount === balance) amount = null;

  // Fall back to content sniffing when headers are unhelpful.
  if (date === null) date = sniffColumn(parsed, (v) => looksLikeDate(v));
  if (amount === null && debit === null && credit === null) {
    amount = sniffColumn(parsed, (v) => looksNumeric(v), balance ?? -1);
  }
  if (description === null) {
    description = sniffColumn(
      parsed,
      (v) => v.trim().length > 3 && !looksNumeric(v) && !looksLikeDate(v)
    );
  }

  return { date, description, amount, debit, credit, splitColumns: debit !== null || credit !== null };
}

function sniffColumn(parsed: ParsedCsv, test: (v: string) => boolean, exclude = -1): number | null {
  const sample = parsed.rows.slice(0, 20);
  if (sample.length === 0) return null;

  let best: { index: number; hits: number } | null = null;
  const width = parsed.headers.length || Math.max(...sample.map((r) => r.length));

  for (let col = 0; col < width; col += 1) {
    if (col === exclude) continue;
    const hits = sample.filter((r) => (r[col] ?? '').trim() !== '' && test(r[col] ?? '')).length;
    if (hits > sample.length * 0.6 && (!best || hits > best.hits)) best = { index: col, hits };
  }
  return best?.index ?? null;
}

// ── Dates ───────────────────────────────────────────────────

export type DateOrder = 'ymd' | 'mdy' | 'dmy' | 'unknown';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Work out whether a set of dates is day-first or month-first.
 *
 * Returns 'unknown' when the sample genuinely cannot tell — every
 * first and second component is 12 or under. The caller must ask
 * rather than assume.
 */
export function detectDateOrder(values: readonly string[]): DateOrder {
  let sawIsoLike = 0;
  let firstOver12 = 0;
  let secondOver12 = 0;
  let numeric = 0;

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;

    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) {
      sawIsoLike += 1;
      continue;
    }
    const m = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    numeric += 1;
    if (Number(m[1]) > 12) firstOver12 += 1;
    if (Number(m[2]) > 12) secondOver12 += 1;
  }

  if (sawIsoLike > 0 && numeric === 0) return 'ymd';
  if (firstOver12 > 0 && secondOver12 === 0) return 'dmy';
  if (secondOver12 > 0 && firstOver12 === 0) return 'mdy';
  if (numeric === 0) return 'unknown';
  return 'unknown';
}

/** Parse a date into ISO YYYY-MM-DD, or null. */
export function parseDateLoose(value: string, order: DateOrder): string | null {
  const text = value.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 5 Jan 2026 / Jan 5, 2026
  const named = text.match(/^(\d{1,2})[\s-]([a-z]{3,})[\s-,]+(\d{2,4})/i);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return buildIso(expandYear(Number(named[3])), month, Number(named[1]));
  }
  const named2 = text.match(/^([a-z]{3,})[\s-](\d{1,2})[\s-,]+(\d{2,4})/i);
  if (named2) {
    const month = MONTHS[named2[1].slice(0, 3).toLowerCase()];
    if (month) return buildIso(expandYear(Number(named2[3])), month, Number(named2[2]));
  }

  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (!numeric) return null;

  const a = Number(numeric[1]);
  const b = Number(numeric[2]);
  const year = expandYear(Number(numeric[3]));

  if (order === 'dmy') return buildIso(year, b, a);
  if (order === 'mdy') return buildIso(year, a, b);
  // Unambiguous even without a declared order.
  if (a > 12 && b <= 12) return buildIso(year, b, a);
  if (b > 12 && a <= 12) return buildIso(year, a, b);
  return null;
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // rejects 31 February and friends
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

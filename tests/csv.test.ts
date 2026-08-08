import { describe, expect, it } from 'vitest';
import {
  detectColumns,
  detectDateOrder,
  parseCsv,
  parseDateLoose,
} from '@/lib/domain/csv';

describe('parseCsv', () => {
  it('handles quoted fields containing commas', () => {
    const { headers, rows } = parseCsv(
      'Date,Description,Amount\n2026-07-01,"Smith, Jane — deposit",1200.00'
    );
    expect(headers).toEqual(['Date', 'Description', 'Amount']);
    expect(rows[0][1]).toBe('Smith, Jane — deposit');
  });

  it('handles escaped quotes and CRLF', () => {
    const { rows } = parseCsv('A,B\r\n1,"He said ""hi"""\r\n');
    expect(rows[0][1]).toBe('He said "hi"');
  });

  it('strips the BOM Excel adds', () => {
    const { headers } = parseCsv('﻿Date,Amount\n2026-01-01,5');
    expect(headers[0]).toBe('Date');
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('Date;Amount\n2026-01-01;5').headers).toEqual(['Date', 'Amount']);
    expect(parseCsv('Date\tAmount\n2026-01-01\t5').headers).toEqual(['Date', 'Amount']);
  });

  it('skips preamble rows above the real header', () => {
    const csv = [
      'Acme Bank — Statement',
      'Account 1234',
      '',
      'Date,Description,Amount',
      '2026-07-01,Coffee,-4.50',
    ].join('\n');
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['Date', 'Description', 'Amount']);
    expect(rows).toHaveLength(1);
  });

  it('ignores blank lines', () => {
    const { rows } = parseCsv('Date,Amount\n2026-01-01,5\n\n\n2026-01-02,6\n');
    expect(rows).toHaveLength(2);
  });
});

describe('detectColumns', () => {
  it('finds date, description and a single signed amount', () => {
    const m = detectColumns(parseCsv('Date,Description,Amount\n2026-07-01,Coffee,-4.50'));
    expect(m).toMatchObject({ date: 0, description: 1, amount: 2, splitColumns: false });
  });

  it('detects separate debit and credit columns', () => {
    const m = detectColumns(
      parseCsv('Date,Details,Withdrawal,Deposit\n2026-07-01,Coffee,4.50,\n2026-07-02,Payout,,1200')
    );
    expect(m.splitColumns).toBe(true);
    expect(m.debit).toBe(2);
    expect(m.credit).toBe(3);
  });

  it('never mistakes a running balance for the amount', () => {
    const m = detectColumns(
      parseCsv('Date,Description,Amount,Balance\n2026-07-01,Coffee,-4.50,995.50')
    );
    expect(m.amount).toBe(2);
    expect(m.amount).not.toBe(3);
  });

  it('falls back to content when headers are unhelpful', () => {
    const m = detectColumns(
      parseCsv(
        'col1,col2,col3\n2026-07-01,Grocery store,-42.10\n2026-07-02,Fuel stop,-61.00\n2026-07-03,Client payment,900.00'
      )
    );
    expect(m.date).toBe(0);
    expect(m.description).toBe(1);
    expect(m.amount).toBe(2);
  });
});

describe('date order', () => {
  it('recognises ISO dates', () => {
    expect(detectDateOrder(['2026-07-01', '2026-07-02'])).toBe('ymd');
  });

  it('infers day-first when a first component exceeds 12', () => {
    expect(detectDateOrder(['13/04/2026', '02/04/2026'])).toBe('dmy');
  });

  it('infers month-first when a second component exceeds 12', () => {
    expect(detectDateOrder(['04/13/2026', '04/02/2026'])).toBe('mdy');
  });

  it('returns unknown when the sample genuinely cannot decide', () => {
    // 03/04 could be 3 April or 4 March. Guessing would silently shift
    // transactions by months, so the importer must ask instead.
    expect(detectDateOrder(['03/04/2026', '05/06/2026'])).toBe('unknown');
  });
});

describe('parseDateLoose', () => {
  it('parses ISO regardless of declared order', () => {
    expect(parseDateLoose('2026-07-01', 'unknown')).toBe('2026-07-01');
  });

  it('respects the declared order for ambiguous values', () => {
    expect(parseDateLoose('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseDateLoose('03/04/2026', 'mdy')).toBe('2026-03-04');
  });

  it('resolves unambiguous values without a declared order', () => {
    expect(parseDateLoose('25/12/2026', 'unknown')).toBe('2026-12-25');
    expect(parseDateLoose('12/25/2026', 'unknown')).toBe('2026-12-25');
  });

  it('refuses to guess a truly ambiguous value', () => {
    expect(parseDateLoose('03/04/2026', 'unknown')).toBeNull();
  });

  it('parses month names in both orders', () => {
    expect(parseDateLoose('5 Jan 2026', 'unknown')).toBe('2026-01-05');
    expect(parseDateLoose('Jan 5, 2026', 'unknown')).toBe('2026-01-05');
  });

  it('expands two-digit years', () => {
    expect(parseDateLoose('01/02/26', 'dmy')).toBe('2026-02-01');
    expect(parseDateLoose('01/02/99', 'dmy')).toBe('1999-02-01');
  });

  it('rejects impossible dates rather than rolling them over', () => {
    expect(parseDateLoose('2026-02-31', 'ymd')).toBeNull();
    expect(parseDateLoose('31/02/2026', 'dmy')).toBeNull();
  });

  it('returns null for junk', () => {
    expect(parseDateLoose('', 'ymd')).toBeNull();
    expect(parseDateLoose('not a date', 'ymd')).toBeNull();
  });
});

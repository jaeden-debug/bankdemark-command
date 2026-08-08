import { describe, expect, it } from 'vitest';
import {
  MoneyPrecisionError,
  addMoney,
  applyRate,
  formatMinor,
  minorUnitExponent,
  money,
  parseMajorToMinor,
  percentChange,
  sumMinor,
} from '@/lib/domain/money';

describe('parseMajorToMinor', () => {
  it('parses plain decimals exactly', () => {
    expect(parseMajorToMinor('6000.00', 'CAD')).toBe(600_000);
    expect(parseMajorToMinor('0.01', 'CAD')).toBe(1);
    expect(parseMajorToMinor('123.45', 'CAD')).toBe(12_345);
  });

  it('parses values that binary floats get wrong', () => {
    // Math.round(1.005 * 100) === 100, which is wrong. String math gives 101.
    expect(parseMajorToMinor('1.005', 'CAD')).toBe(101);
    expect(parseMajorToMinor('8.165', 'CAD')).toBe(817);
    expect(parseMajorToMinor('1.115', 'CAD')).toBe(112);
  });

  it('handles formatting humans actually type', () => {
    expect(parseMajorToMinor('$1,234.56', 'CAD')).toBe(123_456);
    expect(parseMajorToMinor(' 1 234.56 ', 'CAD')).toBe(123_456);
    expect(parseMajorToMinor('(12.34)', 'CAD')).toBe(-1_234);
    expect(parseMajorToMinor('-12.34', 'CAD')).toBe(-1_234);
  });

  it('truncates-then-rounds beyond the minor unit', () => {
    expect(parseMajorToMinor('1.999', 'CAD')).toBe(200);
    expect(parseMajorToMinor('1.994', 'CAD')).toBe(199);
  });

  it('respects zero-decimal and three-decimal currencies', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(parseMajorToMinor('1500', 'JPY')).toBe(1500);
    expect(parseMajorToMinor('1.234', 'KWD')).toBe(1234);
  });

  it('rejects garbage rather than silently returning 0', () => {
    expect(() => parseMajorToMinor('', 'CAD')).toThrow(MoneyPrecisionError);
    expect(() => parseMajorToMinor('abc', 'CAD')).toThrow(MoneyPrecisionError);
  });
});

describe('exact arithmetic', () => {
  it('sums many small amounts without drift', () => {
    // 0.1 + 0.2 !== 0.3 in floats. In minor units it is exact.
    expect(sumMinor([10, 20])).toBe(30);

    const tenThousandDimes = Array.from({ length: 10_000 }, () => 10);
    expect(sumMinor(tenThousandDimes)).toBe(100_000); // exactly $1,000.00
  });

  it('applies a commission rate to whole cents', () => {
    expect(applyRate(600_000, 0.1)).toBe(60_000);
    expect(applyRate(333_33, 0.15)).toBe(5_000); // 15% of $333.33 = $50.00
    expect(applyRate(-10_000, 0.075)).toBe(-750);
  });

  it('refuses to add different currencies', () => {
    expect(() => addMoney(money(100, 'CAD'), money(100, 'USD'))).toThrow(/currency mismatch/i);
  });

  it('rejects fractional minor units', () => {
    expect(() => money(10.5, 'CAD')).toThrow(MoneyPrecisionError);
  });
});

describe('presentation', () => {
  it('formats whole dollars by default and cents on request', () => {
    expect(formatMinor(600_000, 'CAD')).toBe('$6,000');
    expect(formatMinor(600_000, 'CAD', { showMinor: true })).toBe('$6,000.00');
    expect(formatMinor(-1_234, 'CAD', { showMinor: true })).toBe('-$12.34');
  });

  it('returns null for an undefined percentage change instead of Infinity', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(150, 100)).toBeCloseTo(0.5, 10);
    expect(percentChange(50, -100)).toBeCloseTo(1.5, 10);
  });
});

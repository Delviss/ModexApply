import { describe, expect, it } from 'vitest';
import {
  addMoney,
  applyRate,
  compareMoney,
  currencyExponent,
  formatMoney,
  fromMajorString,
  money,
  subtractMoney,
} from '../src/primitives/money.js';

describe('money', () => {
  it('stores integer minor units with an ISO 4217 code', () => {
    expect(money(1425000, 'GBP')).toEqual({ amountMinor: 1425000, currency: 'GBP' });
  });

  it('refuses a fractional minor-unit amount', () => {
    expect(() => money(10.5, 'GBP')).toThrow(/integer minor units/);
  });

  it('refuses a currency code that is not ISO 4217 shaped', () => {
    expect(() => money(100, 'pounds')).toThrow();
  });

  it('parses decimal text without going through a float', () => {
    expect(fromMajorString('14250.00', 'GBP')).toEqual({ amountMinor: 1425000, currency: 'GBP' });
    expect(fromMajorString('1,425.5', 'GBP')).toEqual({ amountMinor: 142550, currency: 'GBP' });
    expect(fromMajorString('-99', 'EUR')).toEqual({ amountMinor: -9900, currency: 'EUR' });
  });

  it('handles zero-exponent and three-exponent currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(fromMajorString('1500', 'JPY')).toEqual({ amountMinor: 1500, currency: 'JPY' });
    expect(fromMajorString('12.345', 'KWD')).toEqual({ amountMinor: 12345, currency: 'KWD' });
  });

  it('refuses to round precision away silently', () => {
    expect(() => fromMajorString('10.005', 'GBP')).toThrow(/Refusing to round/);
    expect(() => fromMajorString('1500.5', 'JPY')).toThrow(/Refusing to round/);
  });

  // 0.1 + 0.2 !== 0.3 is exactly the bug the integer rule exists to prevent.
  it('adds without float drift', () => {
    const total = addMoney(money(10, 'GBP'), money(20, 'GBP'));
    expect(total.amountMinor).toBe(30);
    expect(subtractMoney(money(30, 'GBP'), money(20, 'GBP')).amountMinor).toBe(10);
  });

  it('refuses to combine different currencies', () => {
    expect(() => addMoney(money(100, 'GBP'), money(100, 'EUR'))).toThrow(/Convert explicitly/);
  });

  it('applies a rational rate with explicit rounding', () => {
    // 15% of £142.55 = £21.3825 -> half-up to 2138 minor units.
    expect(applyRate(money(14255, 'GBP'), 15, 100).amountMinor).toBe(2138);
    expect(applyRate(money(14255, 'GBP'), 15, 100, 'down').amountMinor).toBe(2138);
    expect(applyRate(money(101, 'GBP'), 1, 2).amountMinor).toBe(51);
    expect(applyRate(money(101, 'GBP'), 1, 2, 'down').amountMinor).toBe(50);
  });

  it('compares within a currency and formats for display only', () => {
    expect(compareMoney(money(100, 'GBP'), money(200, 'GBP'))).toBe(-1);
    expect(formatMoney(money(1425000, 'GBP'))).toContain('14,250.00');
    expect(formatMoney(money(1500, 'JPY'), 'en-GB')).toContain('1,500');
  });
});

import { z } from 'zod';

/**
 * Money is always integer minor units + an ISO 4217 code (Phase 0 §3.5).
 *
 * There is no `number` of major units anywhere in the platform. A tuition fee of
 * £14,250.00 is `{ amountMinor: 1425000, currency: 'GBP' }`. Floating point for
 * money fails review, so this module deliberately exposes no float constructor —
 * `fromMajorString` parses decimal *text* (what a CSV import or a form field
 * actually carries) without ever going through a binary float.
 */

/** Currencies whose minor unit is not 1/100. Extend as launch markets are added. */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({
  BHD: 3,
  CLP: 0,
  ISK: 0,
  IQD: 3,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
});

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter uppercase ISO 4217 code');

export const MoneySchema = z.object({
  /** Integer minor units. Negative values are allowed only for adjustments/refunds. */
  amountMinor: z.number().int(),
  currency: CurrencyCodeSchema,
});

export type Money = z.infer<typeof MoneySchema>;

export function currencyExponent(currency: string): number {
  return EXPONENT_OVERRIDES[currency] ?? 2;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `Money must be integer minor units; received ${amountMinor} for ${currency}.`,
    );
  }
  return MoneySchema.parse({ amountMinor, currency });
}

export function isMoney(value: unknown): value is Money {
  return MoneySchema.safeParse(value).success;
}

/**
 * Parse a decimal string ("14250.00", "1,425.5") into minor units without
 * touching a float. Used by the CSV/XLSX catalogue importer (Phase 1 §4).
 */
export function fromMajorString(input: string, currency: string): Money {
  const normalised = input.trim().replace(/[\s,_]/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(normalised);
  if (!match) {
    throw new TypeError(`"${input}" is not a valid decimal amount for ${currency}.`);
  }
  const [, sign, whole, fraction = ''] = match;
  const exponent = currencyExponent(currency);
  if (fraction.length > exponent) {
    throw new TypeError(
      `"${input}" has more precision than ${currency} allows (${exponent} minor digits). ` +
        'Refusing to round silently.',
    );
  }
  const padded = fraction.padEnd(exponent, '0');
  const minor = BigInt(whole ?? '0') * BigInt(10 ** exponent) + BigInt(padded === '' ? '0' : padded);
  const signed = sign === '-' ? -minor : minor;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Amount ${input} ${currency} exceeds the safe integer range.`);
  }
  return money(Number(signed), currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

/**
 * Multiply by a rational factor (e.g. a 15% scholarship = 15/100) using integer
 * maths, with an explicit rounding mode. Scholarship and discount maths in Phase 5
 * runs through here rather than through `amount * 0.15`.
 */
export function applyRate(
  value: Money,
  numerator: number,
  denominator: number,
  rounding: 'half-up' | 'down' = 'half-up',
): Money {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new TypeError('applyRate requires an integer numerator and a non-zero integer denominator.');
  }
  const product = BigInt(value.amountMinor) * BigInt(numerator);
  const divisor = BigInt(denominator);
  let result = product / divisor;
  if (rounding === 'half-up') {
    const remainder = (product % divisor) * BigInt(2);
    const absRemainder = remainder < BigInt(0) ? -remainder : remainder;
    const absDivisor = divisor < BigInt(0) ? -divisor : divisor;
    if (absRemainder >= absDivisor) {
      result += product < BigInt(0) ? BigInt(-1) : BigInt(1);
    }
  }
  return money(Number(result), value.currency);
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor === b.amountMinor ? 0 : a.amountMinor < b.amountMinor ? -1 : 1;
}

/** Display only. Never feed the output of this back into a calculation. */
export function formatMoney(value: Money, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: currencyExponent(value.currency),
    maximumFractionDigits: currencyExponent(value.currency),
  }).format(value.amountMinor / 10 ** currencyExponent(value.currency));
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(
      `Cannot combine ${a.currency} with ${b.currency}. Convert explicitly with a dated FX rate.`,
    );
  }
}

import { describe, expect, it } from 'vitest';
import {
  buildImportDiff,
  parseCsv,
  type ExistingProgram,
  type ImportRow,
} from '../src/ingestion/import-diff.js';

const existing: ExistingProgram[] = [
  {
    externalRef: 'MSC-DS',
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    field: 'Computing',
    durationMonths: 12,
    description: 'A taught masters.',
    tuition: { amountMinor: 2400000, currency: 'GBP' },
    applicationDeadline: '2026-08-01T00:00:00.000Z',
    intakeStartDate: '2026-09-20T00:00:00.000Z',
  },
];

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    externalRef: 'MSC-DS',
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    field: 'Computing',
    durationMonths: '12',
    description: 'A taught masters.',
    tuition: '24000.00',
    tuitionCurrency: 'GBP',
    applicationDeadline: '2026-08-01',
    intakeStartDate: '2026-09-20',
    ...overrides,
  };
}

describe('the dry-run diff', () => {
  it('reports an unchanged row as unchanged', () => {
    const { rows, summary } = buildImportDiff([row()], existing);
    expect(rows[0]?.kind).toBe('unchanged');
    expect(rows[0]?.changes).toEqual([]);
    expect(summary.unchanged).toBe(1);
  });

  it('shows the exact before and after for a changed field', () => {
    const { rows, summary } = buildImportDiff([row({ tuition: '25500.00' })], existing);
    expect(rows[0]?.kind).toBe('update');
    const change = rows[0]?.changes.find((entry) => entry.field === 'tuitionFee');
    expect(change).toMatchObject({
      before: '2400000 GBP',
      after: '2550000 GBP',
      // Money is a blocking field: a stale or wrong figure hides the record.
      severity: 'blocking',
    });
    expect(summary.touchesBlockingFields).toBe(true);
  });

  it('treats a description change as warning-severity, not blocking', () => {
    const { summary, rows } = buildImportDiff([row({ description: 'Reworded.' })], existing);
    expect(rows[0]?.changes[0]?.severity).toBe('warning');
    expect(summary.touchesBlockingFields).toBe(false);
  });

  it('ignores whitespace-only differences', () => {
    const { rows } = buildImportDiff([row({ name: '  MSc Data Science  ' })], existing);
    expect(rows[0]?.kind).toBe('unchanged');
  });

  it('reports a row with no matching record as a create', () => {
    const { rows, summary } = buildImportDiff([row({ externalRef: 'BSC-CS' })], existing);
    expect(rows[0]?.kind).toBe('create');
    expect(summary.created).toBe(1);
  });

  describe('validation', () => {
    it('rejects a missing required column', () => {
      const { rows } = buildImportDiff([row({ name: '' })], existing);
      expect(rows[0]?.kind).toBe('error');
      expect(rows[0]?.errors.join(' ')).toMatch(/Missing required column "name"/);
    });

    it('rejects an unrecognised level rather than guessing', () => {
      const { rows } = buildImportDiff([row({ level: 'masters-ish' })], existing);
      expect(rows[0]?.errors.join(' ')).toMatch(/not a recognised programme level/);
    });

    it('rejects a tuition figure with no currency', () => {
      const { rows } = buildImportDiff([row({ tuitionCurrency: '' })], existing);
      expect(rows[0]?.errors.join(' ')).toMatch(/ISO 4217 currency code/);
    });

    it('refuses to round a price that carries too much precision', () => {
      const { rows } = buildImportDiff([row({ tuition: '24000.005' })], existing);
      expect(rows[0]?.errors.join(' ')).toMatch(/Refusing to round/);
    });

    it('rejects a deadline that falls after the intake starts', () => {
      const { rows } = buildImportDiff(
        [row({ applicationDeadline: '2026-10-01', intakeStartDate: '2026-09-20' })],
        existing,
      );
      expect(rows[0]?.errors.join(' ')).toMatch(/deadline falls after the intake start/);
    });

    it('rejects an unparseable date instead of coercing it', () => {
      const { rows } = buildImportDiff([row({ applicationDeadline: '01/08/26' })], existing);
      expect(rows[0]?.errors.join(' ')).toMatch(/not a date we can read/);
    });

    // Last-writer-wins would lose a partner's edit without telling anyone.
    it('flags a duplicate key inside one file', () => {
      const { rows, summary } = buildImportDiff([row(), row({ name: 'Different name' })], existing);
      expect(rows[1]?.kind).toBe('error');
      expect(rows[1]?.errors.join(' ')).toMatch(/Duplicate externalRef/);
      expect(summary.errored).toBe(1);
    });

    it('rejects an out-of-range duration', () => {
      const { rows } = buildImportDiff([row({ durationMonths: '0' })], existing);
      expect(rows[0]?.errors.join(' ')).toMatch(/whole number of months/);
    });
  });
});

describe('the CSV reader', () => {
  it('reads a quoted field containing a comma', () => {
    const parsed = parseCsv('name,field\n"MSc Data Science, Applied",Computing\n');
    expect(parsed[0]).toEqual({ name: 'MSc Data Science, Applied', field: 'Computing' });
  });

  it('reads a doubled quote as a literal quote', () => {
    const parsed = parseCsv('name\n"The ""Big Data"" MSc"\n');
    expect(parsed[0]?.name).toBe('The "Big Data" MSc');
  });

  it('skips blank lines and trims cells', () => {
    const parsed = parseCsv('a,b\n 1 , 2 \n\n3,4\n');
    expect(parsed).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('returns nothing for a header-only file', () => {
    expect(parseCsv('a,b\n')).toEqual([]);
  });
});

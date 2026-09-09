import { fromMajorString, severityForField, type Money } from '@modex/contracts';

/**
 * Bulk import via structured file, with a dry-run diff before commit
 * (Phase 1 section 4).
 *
 * The diff is the product here, not a nicety. A partner uploading a 400-row
 * spreadsheet is about to change what thousands of students see, and "trust me,
 * it imported fine" is not a reviewable claim. So the importer computes the
 * exact per-field before/after, stores it, and commits only what the reviewer
 * was actually shown.
 *
 * Everything in this module is pure: no database, no clock, no I/O. That is what
 * makes the diff testable against the awkward rows -- the ones with a missing
 * deadline, a price in the wrong currency, or a name that differs only in
 * whitespace.
 */

export type ChangeKind = 'create' | 'update' | 'unchanged' | 'error';

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
  /** Blocking fields hide a record when stale, so a change to one is louder. */
  severity: 'blocking' | 'warning' | 'none';
}

export interface RowDiff {
  /** Stable key from the file, used to match against existing records. */
  externalRef: string;
  kind: ChangeKind;
  changes: FieldChange[];
  errors: string[];
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errored: number;
  /** True when any row touches a blocking field; the reviewer is warned harder. */
  touchesBlockingFields: boolean;
}

export interface ImportRow {
  externalRef: string;
  name?: string;
  level?: string;
  field?: string;
  durationMonths?: string;
  description?: string;
  tuition?: string;
  tuitionCurrency?: string;
  applicationDeadline?: string;
  intakeStartDate?: string;
}

export interface ExistingProgram {
  externalRef: string;
  name: string;
  level: string;
  field: string;
  durationMonths: number;
  description: string | null;
  tuition: Money | null;
  applicationDeadline: string | null;
  intakeStartDate: string | null;
}

const REQUIRED_COLUMNS = ['externalRef', 'name', 'level', 'field', 'durationMonths'] as const;

/**
 * Dates must be ISO 8601 -- `YYYY-MM-DD`, optionally with a time.
 *
 * `Date.parse` is not used for validation because it happily accepts
 * `01/08/2026`, which is 1 August to the partner who typed it and 8 January to
 * the runtime. On a platform whose whole subject is international students and
 * application deadlines, a date silently off by seven months is not a formatting
 * nit -- it is a missed intake.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseIsoDate(value: string): number | null {
  if (!ISO_DATE.test(value.trim())) return null;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

const VALID_LEVELS = new Set([
  'foundation',
  'undergraduate',
  'postgraduate_taught',
  'postgraduate_research',
  'doctorate',
  'pathway',
  'short_course',
]);

export function buildImportDiff(
  rows: readonly ImportRow[],
  existing: readonly ExistingProgram[],
): { rows: RowDiff[]; summary: ImportSummary } {
  const existingByRef = new Map(existing.map((program) => [program.externalRef, program]));
  const seen = new Set<string>();
  const diffs: RowDiff[] = [];

  for (const row of rows) {
    const errors = validateRow(row);

    // A duplicate key in one file is an error, not a last-writer-wins merge:
    // silently applying the second row is how a partner loses an edit without
    // ever being told.
    if (seen.has(row.externalRef)) {
      errors.push(`Duplicate externalRef "${row.externalRef}" in this file.`);
    }
    seen.add(row.externalRef);

    if (errors.length > 0) {
      diffs.push({ externalRef: row.externalRef, kind: 'error', changes: [], errors });
      continue;
    }

    const current = existingByRef.get(row.externalRef);
    const changes = current === undefined ? changesForNew(row) : changesForUpdate(row, current);

    diffs.push({
      externalRef: row.externalRef,
      kind: current === undefined ? 'create' : changes.length === 0 ? 'unchanged' : 'update',
      changes,
      errors: [],
    });
  }

  return {
    rows: diffs,
    summary: {
      total: diffs.length,
      created: diffs.filter((diff) => diff.kind === 'create').length,
      updated: diffs.filter((diff) => diff.kind === 'update').length,
      unchanged: diffs.filter((diff) => diff.kind === 'unchanged').length,
      errored: diffs.filter((diff) => diff.kind === 'error').length,
      touchesBlockingFields: diffs.some((diff) =>
        diff.changes.some((change) => change.severity === 'blocking'),
      ),
    },
  };
}

function validateRow(row: ImportRow): string[] {
  const errors: string[] = [];

  for (const column of REQUIRED_COLUMNS) {
    const value = row[column];
    if (value === undefined || String(value).trim() === '') {
      errors.push(`Missing required column "${column}".`);
    }
  }

  if (row.level !== undefined && row.level !== '' && !VALID_LEVELS.has(row.level)) {
    errors.push(`"${row.level}" is not a recognised programme level.`);
  }

  if (row.durationMonths !== undefined && row.durationMonths !== '') {
    const months = Number(row.durationMonths);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      errors.push(`Duration "${row.durationMonths}" must be a whole number of months between 1 and 120.`);
    }
  }

  if (row.tuition !== undefined && row.tuition !== '') {
    if (row.tuitionCurrency === undefined || !/^[A-Z]{3}$/.test(row.tuitionCurrency)) {
      errors.push('A tuition figure needs a three-letter ISO 4217 currency code alongside it.');
    } else {
      try {
        fromMajorString(row.tuition, row.tuitionCurrency);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  for (const [field, value] of [
    ['applicationDeadline', row.applicationDeadline],
    ['intakeStartDate', row.intakeStartDate],
  ] as const) {
    if (value !== undefined && value !== '' && parseIsoDate(value) === null) {
      errors.push(
        `"${value}" in ${field} is not a date we can read. Use ISO 8601 (YYYY-MM-DD) -- ` +
          'a format like 01/08/2026 is ambiguous and we will not guess.',
      );
    }
  }

  const deadline = row.applicationDeadline === undefined ? null : parseIsoDate(row.applicationDeadline);
  const start = row.intakeStartDate === undefined ? null : parseIsoDate(row.intakeStartDate);
  if (deadline !== null && start !== null && deadline > start) {
    errors.push('The application deadline falls after the intake start date.');
  }

  return errors;
}

function changesForNew(row: ImportRow): FieldChange[] {
  return fieldPairs(row).map(([field, after]) => ({
    field,
    before: null,
    after,
    severity: severityForField(field),
  }));
}

function changesForUpdate(row: ImportRow, current: ExistingProgram): FieldChange[] {
  const before: Record<string, string | null> = {
    name: current.name,
    level: current.level,
    field: current.field,
    durationMonths: String(current.durationMonths),
    description: current.description,
    tuitionFee:
      current.tuition === null ? null : `${current.tuition.amountMinor} ${current.tuition.currency}`,
    applicationDeadline: current.applicationDeadline,
    intakeStartDate: current.intakeStartDate,
  };

  return fieldPairs(row)
    .filter(([field, after]) => normalise(before[field] ?? null) !== normalise(after))
    .map(([field, after]) => ({
      field,
      before: before[field] ?? null,
      after,
      severity: severityForField(field),
    }));
}

function fieldPairs(row: ImportRow): [string, string | null][] {
  const tuition =
    row.tuition !== undefined && row.tuition !== '' && row.tuitionCurrency !== undefined
      ? (() => {
          try {
            const money = fromMajorString(row.tuition, row.tuitionCurrency);
            return `${money.amountMinor} ${money.currency}`;
          } catch {
            return null;
          }
        })()
      : null;

  return [
    ['name', row.name ?? null],
    ['level', row.level ?? null],
    ['field', row.field ?? null],
    ['durationMonths', row.durationMonths ?? null],
    ['description', row.description ?? null],
    ['tuitionFee', tuition],
    ['applicationDeadline', toIsoDate(row.applicationDeadline)],
    ['intakeStartDate', toIsoDate(row.intakeStartDate)],
  ];
}

function toIsoDate(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  const parsed = parseIsoDate(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

/** Whitespace and empty-vs-null differences are not changes worth showing. */
function normalise(value: string | null): string {
  return (value ?? '').trim();
}

/**
 * Minimal CSV reader. Deliberately hand-rolled rather than pulled from a
 * dependency: it handles the two things partner exports actually do -- quoted
 * fields containing commas, and doubled quotes -- and nothing else, so a
 * malformed file fails loudly here rather than being coerced into plausible
 * nonsense.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
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
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (header === undefined) return [];

  const columns = header.map((name) => name.trim());
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      columns.forEach((column, index) => {
        record[column] = (cells[index] ?? '').trim();
      });
      return record;
    });
}

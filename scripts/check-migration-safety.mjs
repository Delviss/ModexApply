#!/usr/bin/env node
/**
 * Migration safety check (Phase 0 section 3.1).
 *
 * Blue/green and rolling deploys mean the old code and the new code run against
 * the same schema at the same time, for minutes. A migration that drops a column
 * the previous release still reads takes production down during what everyone
 * believed was a zero-downtime deploy.
 *
 * So destructive statements are refused unless the migration explicitly declares
 * it has been through the expand/contract dance, with the release that stopped
 * using the column named:
 *
 *   -- modex:expand-contract-verified released-in=v1.4.0 reason=...
 *
 * The audit table has its own rule: nothing may weaken the append-only triggers.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'apps/api/prisma/migrations');

const DESTRUCTIVE = [
  { pattern: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
  { pattern: /\bDROP\s+COLUMN\b/i, label: 'DROP COLUMN' },
  { pattern: /\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i, label: 'SET NOT NULL' },
  { pattern: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i, label: 'ALTER COLUMN TYPE' },
  { pattern: /\bDROP\s+CONSTRAINT\b/i, label: 'DROP CONSTRAINT' },
  // Statement-initial only: `BEFORE TRUNCATE ON` in a trigger definition and
  // `REVOKE ... TRUNCATE` are how the append-only guarantee is installed, not
  // data loss.
  { pattern: /^\s*TRUNCATE\b/im, label: 'TRUNCATE' },
  { pattern: /\bRENAME\s+(TABLE|COLUMN|TO)\b/i, label: 'RENAME' },
];

/** Weakening these would quietly undo the append-only guarantee. */
const AUDIT_GUARDS = [
  { pattern: /DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?audit_events_no_/i, label: 'dropping an audit trigger' },
  { pattern: /DROP\s+FUNCTION\s+(IF\s+EXISTS\s+)?audit_events_append_only/i, label: 'dropping the audit guard function' },
  { pattern: /GRANT\s+[^;]*\b(UPDATE|DELETE|TRUNCATE)\b[^;]*\bON\s+audit_events/i, label: 'granting write access to audit_events' },
];

const VERIFIED = /--\s*modex:expand-contract-verified\s+released-in=\S+/i;
/** The append-only migration re-installs its own triggers; that is its job. */
const AUDIT_OWNER = /--\s*modex:audit-append-only-migration/i;

function listMigrations(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory())
    .map((path) => join(path, 'migration.sql'))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

const problems = [];
const files = listMigrations(MIGRATIONS_DIR);

for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  const rel = relative(REPO_ROOT, file);
  const declaredVerified = VERIFIED.test(sql);
  const isAuditOwner = AUDIT_OWNER.test(sql);

  for (const { pattern, label } of DESTRUCTIVE) {
    if (pattern.test(sql) && !declaredVerified) {
      problems.push(
        `${rel}: contains ${label} with no expand/contract declaration.\n` +
          '    Add: -- modex:expand-contract-verified released-in=<version> reason=<why it is safe>\n' +
          '    A destructive change is safe only once no running release reads the column.',
      );
    }
  }

  for (const { pattern, label } of AUDIT_GUARDS) {
    if (pattern.test(sql) && !isAuditOwner) {
      problems.push(
        `${rel}: ${label}. The audit log is append-only by design (Phase 0 section 3.3).\n` +
          '    If this is the migration that owns those triggers, mark it with:\n' +
          '    -- modex:audit-append-only-migration',
      );
    }
  }
}

console.log(`Checked ${files.length} migration(s).`);
if (problems.length > 0) {
  console.error(`\n${problems.length} migration safety problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}
console.log('No unsafe migrations.');

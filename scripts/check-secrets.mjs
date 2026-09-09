#!/usr/bin/env node
/**
 * Secret scan (Phase 0 section 3.1).
 *
 * Catches the credential shapes that actually get committed: provider keys,
 * private key blocks, connection strings with an inline password, and JWTs. It
 * complements rather than replaces the platform's own push protection -- the
 * point of running it here is that a developer finds out before the push, not
 * after the key is already in the history.
 *
 * `API_KEY_21ST` gets its own rule because issue #2 section 3.1 names it: it
 * belongs in the managed secret store and must never be committed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.next', '.git', 'coverage', 'storybook-static', 'generated', '.cache',
]);
const SKIP_FILES = new Set(['pnpm-lock.yaml', '.env.example']);
const SCANNED = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.yml', '.yaml', '.env', '.sql', '.tf', '.md', '.sh']);

const RULES = [
  { label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Stripe secret key', pattern: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { label: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    label: 'connection string with an inline password',
    pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:(?!modex\b)[^\s:/@]{3,}@/,
  },
  { label: '21st.dev API key', pattern: /API_KEY_21ST\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/ },
  {
    label: 'assigned secret literal',
    pattern:
      /\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'][A-Za-z0-9/+_-]{24,}["']/i,
  },
];

/** A line carrying this marker is exempt and must say why on the same line. */
const ALLOW = /modex:allow-secret-match:/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCANNED.has(extname(name)) || name.startsWith('.env')) yield path;
  }
}

const findings = [];
let scanned = 0;

for (const file of walk(REPO_ROOT)) {
  scanned += 1;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (ALLOW.test(line)) return;
    for (const { label, pattern } of RULES) {
      if (pattern.test(line)) {
        findings.push({ file: relative(REPO_ROOT, file), line: index + 1, label });
      }
    }
  });
}

console.log(`Scanned ${scanned} files.`);
if (findings.length > 0) {
  console.error(`\n${findings.length} possible secret(s) committed:\n`);
  for (const finding of findings) {
    // The value itself is never printed: a CI log is not a safer place for it.
    console.error(`  ${finding.file}:${finding.line}  ${finding.label}`);
  }
  console.error('\nMove the value to the managed secret store and rotate it — it is already exposed.');
  console.error('If this is a false positive, add "modex:allow-secret-match: <reason>" on the line.');
  process.exit(1);
}
console.log('No committed secrets found.');

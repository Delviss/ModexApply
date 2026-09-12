#!/usr/bin/env node
/**
 * "An alert with no runbook does not ship" (Phase 7 §5), enforced.
 *
 * Three checks, and the third is the one that catches the failure nobody
 * notices:
 *
 *  1. Every alert names an owner and a severity.
 *  2. Every alert points at a runbook file that exists and is not a stub.
 *  3. Every alert's metric is actually recorded somewhere in the API. An alert
 *     defined over a metric that was renamed is an alert that can never fire,
 *     which is worse than no alert: the dashboard looks covered.
 *
 * The YAML is parsed with a deliberately small reader rather than a dependency.
 * The file is ours, its shape is fixed, and adding a parser to the toolchain to
 * read one config file is how a zero-dependency check stops being one.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const ALERTS_FILE = resolve(REPO_ROOT, 'infra/observability/alerts.yaml');
const TELEMETRY_DIR = resolve(REPO_ROOT, 'apps/api/src');
const REQUIRED_SECTIONS = ['## Symptom', '## First checks', '## Fixing it', '## If it is not that'];
const SEVERITIES = new Set(['sev1', 'sev2', 'sev3']);
const OWNERS = new Set(['platform-oncall', 'trust-oncall', 'security-oncall', 'finance-oncall']);

/** Reads `alerts:` as a list of flat key/value records. Nothing more. */
function readAlerts(source) {
  const alerts = [];
  let current = null;
  let pendingKey = null;

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (line === 'alerts:') continue;

    const item = /^\s{2}- (\w+):\s*(.*)$/.exec(line);
    if (item !== null) {
      if (current !== null) alerts.push(current);
      current = { [item[1]]: unquote(item[2]) };
      pendingKey = item[2] === '>-' ? item[1] : null;
      continue;
    }

    const field = /^\s{4}(\w+):\s*(.*)$/.exec(line);
    if (field !== null && current !== null) {
      current[field[1]] = unquote(field[2]);
      pendingKey = field[2] === '>-' ? field[1] : null;
      continue;
    }

    // A folded block's continuation lines.
    if (pendingKey !== null && current !== null && /^\s{6}/.test(line)) {
      current[pendingKey] = `${current[pendingKey] === '>-' ? '' : current[pendingKey]} ${line.trim()}`.trim();
    }
  }
  if (current !== null) alerts.push(current);
  return alerts;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (path.endsWith('.ts')) yield path;
  }
}

const problems = [];

if (!existsSync(ALERTS_FILE)) {
  console.error(`No alert definitions at ${ALERTS_FILE}`);
  process.exit(1);
}

const alerts = readAlerts(readFileSync(ALERTS_FILE, 'utf8'));
if (alerts.length === 0) problems.push('No alerts are defined.');

const apiSource = [...walk(TELEMETRY_DIR)].map((path) => readFileSync(path, 'utf8')).join('\n');

for (const alert of alerts) {
  const name = alert.name ?? '(unnamed)';

  for (const field of ['name', 'severity', 'owner', 'runbook', 'metric', 'condition', 'summary']) {
    if (alert[field] === undefined || alert[field] === '') {
      problems.push(`${name}: missing "${field}"`);
    }
  }

  if (alert.severity !== undefined && !SEVERITIES.has(alert.severity)) {
    problems.push(`${name}: severity "${alert.severity}" is not one of ${[...SEVERITIES].join(', ')}`);
  }
  if (alert.owner !== undefined && !OWNERS.has(alert.owner)) {
    problems.push(`${name}: owner "${alert.owner}" is not a known rota`);
  }

  if (alert.runbook !== undefined) {
    const runbook = resolve(REPO_ROOT, alert.runbook);
    if (!existsSync(runbook)) {
      problems.push(`${name}: runbook ${alert.runbook} does not exist`);
    } else {
      const body = readFileSync(runbook, 'utf8');
      for (const section of REQUIRED_SECTIONS) {
        if (!body.includes(section)) problems.push(`${alert.runbook}: no "${section}" section`);
      }
      if (body.length < 600) {
        problems.push(`${alert.runbook}: too short to be a runbook somebody could follow at 3am`);
      }
    }
  }

  if (alert.metric !== undefined && !apiSource.includes(`'${alert.metric}'`)) {
    problems.push(
      `${name}: nothing in apps/api records the metric "${alert.metric}" — this alert can never fire`,
    );
  }
}

if (problems.length > 0) {
  console.error(`Alert definitions are incomplete (${problems.length}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nAn alert with no runbook does not ship (Phase 7 §5).');
  process.exit(1);
}

console.log(`Checked ${alerts.length} alerts. Every one has an owner, a runbook and a live metric.`);

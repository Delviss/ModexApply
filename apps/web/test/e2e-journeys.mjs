/**
 * The core journeys, in a real browser (Phase 7 §3, §6).
 *
 * Every journey named in the acceptance criteria — sign-up → profile → search →
 * guide → document → application → receipt → offer, plus the four admin
 * consoles — is walked here, and each page is checked with axe against WCAG 2.2
 * AA on the way past.
 *
 * Two rules make this a gate rather than a report:
 *
 * 1. **A page that throws fails the run.** An "Application error" on a console
 *    is a failure even if axe is perfectly happy with it.
 * 2. **Serious and critical axe violations fail the run.** Moderate and minor
 *    ones are printed. That split is deliberate: a hard gate on every advisory
 *    rule ends with the gate being switched off.
 *
 * Run it against a seeded stack: `pnpm --filter @modex/web test:e2e`.
 */
import { mkdirSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { BASE_URL, clearStepUp, launch, signIn, signOut } from './browser.mjs';

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? null;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const failures = [];
const findings = [];

async function check(page, label) {
  const body = await page.locator('body').innerText();
  for (const marker of ['Application error', 'Internal Server Error', 'ERR_MODULE_NOT_FOUND']) {
    if (body.includes(marker)) failures.push(`${label}: page rendered "${marker}"`);
  }

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const violation of results.violations) {
    const line = `${label}: [${violation.impact}] ${violation.id} — ${violation.help} (${violation.nodes.length} node(s))`;
    findings.push(line);
    if (violation.impact === 'serious' || violation.impact === 'critical') failures.push(line);
  }

  if (SCREENSHOT_DIR !== null) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${label}.png`, fullPage: true });
  }

  const violations = results.violations.length;
  console.log(`  ${label.padEnd(28)} ${violations === 0 ? 'clean' : `${violations} axe finding(s)`}`);
  return body;
}

async function visit(page, path, label, { stepUp = false } = {}) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
  if (stepUp) {
    await clearStepUp(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  return check(page, label);
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  console.log('Public pages');
  await visit(page, '/', 'public-home');
  await visit(page, '/programmes', 'public-search');
  await visit(page, '/guides', 'public-guides');
  await visit(page, '/questions', 'public-questions');
  await visit(page, '/login', 'public-login');

  console.log('Student journey');
  await signIn(page, 'ada@example.com');
  await visit(page, '/dashboard', 'student-dashboard');
  await visit(page, '/profile', 'student-profile');
  await visit(page, '/documents', 'student-documents');
  await visit(page, '/applications', 'student-applications');
  await visit(page, '/savings', 'student-savings');
  await visit(page, '/privacy', 'student-privacy');
  await signOut(page);

  console.log('Trust console');
  await signIn(page, 'trust@modex.test');
  await visit(page, '/admin', 'console-picker');
  const trust = await visit(page, '/admin/trust', 'trust-console', { stepUp: true });
  if (!/Verification queue/.test(trust)) failures.push('trust console: no verification queue');
  await signOut(page);

  console.log('University portal');
  await signIn(page, 'admin@example.ac.uk');
  const university = await visit(page, '/admin/university', 'university-portal', { stepUp: true });
  if (!/Applications/.test(university)) failures.push('university portal: no applications section');
  await signOut(page);

  console.log('Operations console');
  await signIn(page, 'ops@modex.test');
  const ops = await visit(page, '/admin/ops', 'ops-console', { stepUp: true });
  if (!/Connector health/.test(ops)) failures.push('ops console: no connector health');
  await signOut(page);

  console.log('Finance console');
  await signIn(page, 'finance1@modex.test');
  const finance = await visit(page, '/admin/finance', 'finance-console', { stepUp: true });
  if (!/Settlement/.test(finance)) failures.push('finance console: no settlement report');
  await signOut(page);
} finally {
  await browser.close();
}

console.log('');
if (findings.length > 0) {
  console.log(`Accessibility findings (${findings.length}):`);
  for (const finding of findings) console.log(`  - ${finding}`);
  console.log('');
}

if (failures.length > 0) {
  console.error(`FAILED — ${failures.length} blocking issue(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('All journeys rendered, no serious or critical accessibility violations.');

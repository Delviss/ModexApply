/**
 * The published site, driven in a real browser.
 *
 * This is the gate that matters for a static build: the bundle can compile and
 * still be a blank page, so every route is visited, every console error is a
 * failure, and the three journeys that carry the product's promises — a
 * submission that only counts when it is confirmed, a scam attempt that is
 * caught and evidenced, a university entered against the evidence rules — are
 * walked end to end.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const BASE = 'http://127.0.0.1:4321';

let failures = 0;
const check = (label, condition) => {
  if (condition) console.log(`  ok   ${label}`);
  else { failures += 1; console.error(`  FAIL ${label}`); }
};

const server = spawn(process.execPath, [resolve(root, 'serve.mjs')], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

await new Promise((done) => setTimeout(done, 600));

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await context.route(/^https:\/\/fonts\./, (route) => route.abort());

const errors = [];
const failedRequests = [];
page.on('console', (message) => {
  // The blocked webfont surfaces here as a resource error; the assertion that
  // matters — nothing the site itself serves failed — is `failedRequests`.
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    errors.push(message.text());
  }
});
page.on('pageerror', (error) => errors.push(String(error)));
page.on('requestfailed', (request) => {
  if (request.url().startsWith(BASE)) failedRequests.push(request.url());
});

/** Each box is re-resolved: a change re-renders the list it lives in. */
async function checkEvery(selector) {
  const count = await page.locator(selector).count();
  for (let index = 0; index < count; index += 1) await page.locator(selector).nth(index).check();
}

async function go(hash, expected) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#main')?.textContent?.length > 40, null, { timeout: 8000 });
  const text = await page.textContent('#main');
  check(`${hash} renders "${expected}"`, text.includes(expected));
}

console.log('routes');
await go('/', 'Apply directly to verified universities');
await go('/programmes', 'Programmes');
await go('/programmes/example-msc-computer-science', 'MSc Computer Science');
await go('/institutions/inst-example', 'Verification');
await go('/guides', 'Verified student guides');
await go('/guides/guide-amara', 'Verification');
await go('/questions', 'Questions answered by students');
await go('/savings', 'Scholarships, waivers and discounts');
await go('/applications', 'My applications');
await go('/profile', 'Your profile');
await go('/messages', 'Messages');
await go('/admin', 'Admin consoles');
await go('/admin/university', 'Enter a university');
await go('/admin/catalogue', 'Programme records');
await go('/admin/trust', 'Cases');
await go('/admin/ops', 'Connectors');
await go('/admin/finance', 'Reward ledger');
await go('/nonsense/route', 'That page does not exist');

console.log('the money rule');
await go('/programmes/northern-msc-cyber-security', 'Tuition withheld');
check('the stale figure itself is never rendered',
  !(await page.textContent('#main')).includes('19,900'));

console.log('the anti-scam pipeline');
await page.goto(`${BASE}/#/messages?guide=guide-amara`, { waitUntil: 'load' });
await page.waitForSelector('.composer textarea');
await page.check('#as-guide');
await page.fill('.composer textarea', 'Send the £2,000 deposit to my account today and I guarantee your admission.');
await page.click('.composer .btn-primary');
await page.waitForSelector('.notice-warning', { timeout: 5000 });
const thread = await page.textContent('#main');
check('the student is warned in-thread', thread.includes('request for money'));
check('the message is not deleted', thread.includes('Send the £2,000 deposit'));
check('the guide is suspended by the pipeline', thread.toLowerCase().includes('suspend'));

await go('/admin/trust', 'Payment solicitation');
const trust = await page.textContent('#main');
check('a trust case opened automatically', trust.includes('Payment solicitation'));
check('the evidence is preserved on the case', trust.toLowerCase().includes('evidence preserved'));

await go('/guides', 'Verified student guides');
check('a suspended guide leaves the directory',
  !(await page.textContent('#main')).includes('Amara O.') ||
  (await page.textContent('#main')).includes('withheld from this directory'));

console.log('the application journey');
await page.goto(`${BASE}/#/apply/example-msc-computer-science?step=1`, { waitUntil: 'load' });
await page.waitForSelector('input[name="intake"]');
await page.click('input[name="intake"]');
await page.click('text=Continue');
await page.waitForSelector('text=Readiness');
await checkEvery('.check input[type="checkbox"]');
await page.click('text=Continue');
await page.waitForSelector('text=Consents');
await checkEvery('.check input[type="checkbox"]');
await page.click('text=Continue');
await page.waitForSelector('pre');
const canonical = await page.textContent('pre');
check('the review shows the canonical payload', canonical.includes('"programKey"'));
await page.click('text=Continue to submit');
await page.waitForSelector('text=Send to the university');
await page.click('text=Send to the university');
await page.waitForSelector('dialog');
await page.click('dialog >> text=Send it');
await page.waitForSelector('text=Submission receipt', { timeout: 15000 });
const receipt = await page.textContent('#main');
check('the receipt carries the university’s own reference', /EX-2026-\d{6}/.test(receipt));
check('the receipt carries a payload checksum', receipt.includes('Payload checksum'));

console.log('entering a university');
await page.goto(`${BASE}/#/admin/university`, { waitUntil: 'load' });
await page.waitForSelector('text=Enter a university');
const before = (await page.textContent('#main')).match(/Register \((\d+)\)/)[1];
await page.fill('input[placeholder="University of Somewhere"]', 'Test University of Somewhere');
await page.fill('input[placeholder="GB"]', 'GB');
await page.fill('input[placeholder="Somewhere"]', 'Somewhere');
await page.fill('input[placeholder="somewhere.ac.uk"]', 'somewhere.ac.uk');
await page.fill('input[placeholder="https://www.somewhere.ac.uk"]', 'https://www.somewhere.ac.uk');
await page.click('text=Enter into the register');
await page.waitForFunction((count) => document.querySelector('#main').textContent.includes(`Register (${count})`),
  Number(before) + 1, { timeout: 5000 });
check('the entered university joins the register', true);

await page.fill('input[placeholder="University of Somewhere"]', 'Duplicate');
await page.fill('input[placeholder="GB"]', 'GB');
await page.fill('input[placeholder="Somewhere"]', 'Somewhere');
await page.fill('input[placeholder="somewhere.ac.uk"]', 'somewhere.ac.uk');
await page.fill('input[placeholder="https://www.somewhere.ac.uk"]', 'https://www.somewhere.ac.uk');
await page.click('text=Enter into the register');
await page.waitForSelector('.notice-danger');
check('a duplicate domain is refused',
  (await page.textContent('.notice-danger')).includes('already in the register'));

console.log('accessibility basics');
await go('/programmes', 'Programmes');
check('one h1 per page', (await page.$$('h1')).length === 1);
check('the skip link exists', (await page.$('.skip-link')) !== null);
check('every image-free control has a name',
  (await page.$$eval('button', (buttons) => buttons.every((one) =>
    (one.textContent ?? '').trim().length > 0 || one.getAttribute('aria-label')))) === true);

check('no console errors anywhere', errors.length === 0);
if (errors.length > 0) for (const error of errors) console.error(`       ${error}`);
check('every request the site makes succeeds', failedRequests.length === 0);
if (failedRequests.length > 0) for (const url of failedRequests) console.error(`       ${url}`);

await browser.close();
stop();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll site checks passed.');

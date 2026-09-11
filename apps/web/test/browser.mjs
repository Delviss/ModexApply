/**
 * Shared browser helpers for the end-to-end checks (Phase 7).
 *
 * These drive a real Chromium against a running stack rather than a mocked one.
 * The whole point of the exercise is the things a unit test cannot see: a focus
 * ring that never appears, a table nobody can reach by keyboard, a console that
 * renders an error because a server component threw.
 */
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const character of input.toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The same RFC 6238 code the API expects, so the staff journeys can sign in. */
export function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const DEV_PASSWORD = process.env.E2E_PASSWORD ?? 'ModexDev!Passw0rd';
export const DEV_TOTP_SECRET = process.env.E2E_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * The browser binary.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` is honoured by Playwright itself; the explicit
 * path is the fallback for environments that pre-install Chromium somewhere
 * this project did not download it to.
 */
export async function launch() {
  const executablePath = process.env.E2E_CHROMIUM_PATH;
  return chromium.launch(executablePath === undefined ? {} : { executablePath });
}

export async function signIn(page, email) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/login\/mfa|dashboard|admin/, { timeout: 30_000 });

  // Staff accounts land on the challenge; students go straight through. The
  // branch is the assertion: a staff account that skipped it would be a bug.
  if (page.url().includes('/login/mfa')) {
    await page.getByLabel(/six-digit code/i).fill(totp(DEV_TOTP_SECRET));
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  }
  return page.url();
}

/** Clears the step-up interstitial if the page is showing one. */
export async function clearStepUp(page) {
  const heading = page.getByRole('heading', { name: /confirm it is you/i });
  if (!(await heading.isVisible().catch(() => false))) return false;
  await page.getByLabel(/code from your authenticator/i).fill(totp(DEV_TOTP_SECRET));
  await page.getByRole('button', { name: /^confirm$/i }).click();
  await page.waitForTimeout(2_500);
  return true;
}

/**
 * Ends the session.
 *
 * Cookies are cleared first and the server call is best-effort: the session
 * cookie is the only thing that authenticates the next journey, so a dev-server
 * socket hiccup on the sign-out call must not fail a run that has already
 * proved what it set out to.
 */
export async function signOut(page) {
  await page.context().clearCookies();
  await page.request.delete(`${BASE_URL}/api/session`).catch(() => undefined);
}

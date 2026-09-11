import { ApiError, apiGetAs } from './api';
import { sessionToken } from './session';
import type { Console, Permission, Role } from '@modex/contracts';

/**
 * Server-side helpers for the four admin consoles (Phase 6).
 *
 * Console pages are server components: they read the httpOnly session cookie,
 * call the API, and pass only *data* to the client. The access token never
 * reaches the browser, which matters more here than anywhere else on the site —
 * a token that can read the trust queue is a token worth stealing.
 *
 * The unusual part is `loadConsole`. Three refusals are not errors to this
 * layer, they are *states the page renders*:
 *
 * - `step_up_required` → show the interstitial, not an error page.
 * - `mfa_required` → send them to the challenge.
 * - `unauthenticated` → send them to sign in.
 *
 * Treating those as thrown errors would give an operator a 500 for the entirely
 * normal event of their fifteen-minute window expiring.
 */

export interface ConsoleSession {
  userId: string;
  roles: Role[];
  organisationId: string | null;
  consoles: Console[];
  permissions: Permission[];
  stepUp: { fresh: boolean; at: string | null; expiresAt: string | null; ttlMinutes: number };
  impersonatedBy: string | null;
}

export type ConsoleState<T> =
  | { status: 'ready'; session: ConsoleSession; data: T }
  | { status: 'signed_out' }
  | { status: 'mfa_required' }
  | { status: 'step_up_required'; session: ConsoleSession | null }
  | { status: 'forbidden'; message: string }
  | { status: 'blocked'; message: string };

async function readSession(token: string): Promise<ConsoleSession | null> {
  try {
    return await apiGetAs<ConsoleSession>('/admin/session', token);
  } catch {
    // The session endpoint itself needs no permission and no step-up, so a
    // failure here means the session is gone rather than under-privileged.
    return null;
  }
}

/**
 * Loads one console's data, or the reason it cannot be shown.
 *
 * `load` receives the token so a page can make several calls; the first refusal
 * decides the state, because a half-rendered console is worse than an honest
 * interstitial.
 */
export async function loadConsole<T>(
  load: (token: string) => Promise<T>,
): Promise<ConsoleState<T>> {
  const token = await sessionToken();
  if (token === null) return { status: 'signed_out' };

  const session = await readSession(token);
  if (session === null) return { status: 'signed_out' };

  try {
    return { status: 'ready', session, data: await load(token) };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.code === 'step_up_required') return { status: 'step_up_required', session };
    if (error.code === 'mfa_required') return { status: 'mfa_required' };
    if (error.code === 'unauthenticated' || error.code === 'token_expired') {
      return { status: 'signed_out' };
    }
    if (error.code === 'forbidden' || error.code === 'organisation_boundary') {
      return { status: 'forbidden', message: error.message };
    }
    // `precondition_failed` is the portal gate: a real institution whose domain
    // is not confirmed. It gets its own state because the remedy is completing
    // verification, not signing in again.
    if (error.code === 'precondition_failed') return { status: 'blocked', message: error.message };
    throw error;
  }
}

export { apiGetAs as consoleGet };

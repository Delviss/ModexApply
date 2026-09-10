import { cookies } from 'next/headers';

/**
 * The student's session, read on the server.
 *
 * The access token lives in an httpOnly cookie, so it never reaches client
 * JavaScript and an XSS on any page cannot lift it. Every authenticated page is
 * a server component that reads it here and passes only the *data* to the
 * client, never the token.
 *
 * Sign-in itself is Phase 0's `/v1/auth/*`; this is the read side.
 */
export const SESSION_COOKIE = 'modex_session';

export async function sessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** True when there is a token to try. Not a claim that it is still valid. */
export async function isSignedIn(): Promise<boolean> {
  return (await sessionToken()) !== null;
}

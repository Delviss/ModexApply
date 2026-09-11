import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { SESSION_COOKIE, sessionToken } from '@/lib/session';

/**
 * The login MFA challenge.
 *
 * Unlike step-up, this one returns a **new access token**: the session has gone
 * from un-satisfied to satisfied, and the token in the cookie still claims
 * otherwise. It is rewritten here, server-side, with the same httpOnly flags as
 * sign-in — a client that had to store it would defeat the whole arrangement.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    const result = await apiSend<{ accessToken: string }>(
      'POST',
      '/auth/mfa/challenge',
      token,
      body,
    );

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: result.accessToken,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 900,
    });
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

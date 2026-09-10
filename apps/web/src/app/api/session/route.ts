import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Exchanges credentials for a session cookie.
 *
 * The access token is written httpOnly so client JavaScript can never read it —
 * an XSS anywhere on the site cannot lift a student's session. `sameSite: lax`
 * keeps it off cross-site requests while still surviving an ordinary
 * navigation, and `secure` is on everywhere but local development.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const session = await apiSend<{ accessToken: string; expiresIn?: number }>(
      'POST',
      '/auth/login',
      '',
      body,
    );

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: session.accessToken,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: session.expiresIn ?? 900,
    });
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

/** Sign out: drop the cookie. The API session is revoked separately. */
export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Starts TOTP enrolment and returns the secret **once**.
 *
 * The secret has to reach the browser — that is what the authenticator app
 * scans — so this is the one response in the admin surface that carries one.
 * It is never stored client-side, never logged, and there is no endpoint that
 * hands it out a second time: a lost enrolment is re-done, not recovered.
 */
export async function POST(): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  try {
    return NextResponse.json(
      await apiSend<{ secret: string; otpauthUrl: string }>('POST', '/auth/mfa/enrol', token),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { message: error.message, code: error.code } },
        { status: error.status },
      );
    }
    throw error;
  }
}

/** Confirms enrolment with the first code the app produces. */
export async function PUT(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(
      await apiSend<unknown>('POST', '/auth/mfa/enrol/confirm', token, body),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

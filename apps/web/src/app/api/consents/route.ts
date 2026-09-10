import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Grants a consent scope.
 *
 * `guide_access` is granted here, from the student's own click on "start a
 * conversation" — being signed in is not consent to be put in touch with
 * another person (Phase 0 §3.2). The wording version travels with the grant so
 * we can always say what the student actually agreed to.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await apiSend<unknown>('POST', '/auth/consents', token, body));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/** Autosave target. Keeps the session token out of client JavaScript. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to edit your profile.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await apiSend<unknown>('PATCH', '/me/profile', token, body));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { message: error.message, details: error.details } },
        { status: error.status },
      );
    }
    throw error;
  }
}

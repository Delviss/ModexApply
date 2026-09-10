import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Opens a conversation with a guide.
 *
 * A thin proxy, like every other route handler here: the session token stays in
 * the httpOnly cookie and never reaches client JavaScript. The API decides
 * whether the guide is contactable, whether consent was granted, and whether
 * this student already has a thread with them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json(
      { error: { message: 'Sign in to message a student guide.' } },
      { status: 401 },
    );
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await apiSend<unknown>('POST', '/conversations', token, body));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

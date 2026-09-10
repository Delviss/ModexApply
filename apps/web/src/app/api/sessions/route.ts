import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/** Books a session slot. The API holds the row lock; this only forwards. */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to book a session.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await apiSend<unknown>('POST', '/sessions', token, body));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

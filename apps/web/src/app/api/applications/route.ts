import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/** Starts an application from a programme page. */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json(
      { error: { message: 'Sign in to start an application.' } },
      { status: 401 },
    );
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await apiSend<unknown>('POST', '/applications', token, body));
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

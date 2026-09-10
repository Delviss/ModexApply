import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Reports a guide, a message, an offer or an institutional claim (FR-015).
 *
 * Every authenticated role can post here — including guides, who need the same
 * button when a student is the problem.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to report this.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await apiSend<unknown>('POST', '/reports', token, body));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

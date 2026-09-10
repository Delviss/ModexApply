import { NextResponse } from 'next/server';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Reads one thread.
 *
 * `apiGetAs` never caches — the thread is owner-scoped, and Next's data cache is
 * keyed on the URL rather than on the session, which on this route would mean
 * one student's conversation served to the next.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to read your messages.' } }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    return NextResponse.json(
      await apiGetAs<unknown>(`/conversations/${encodeURIComponent(id)}`, token),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

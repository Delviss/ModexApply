import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Closes a conversation — the "block" half of report-and-block.
 *
 * Closing does not delete anything: the thread stays readable to both people
 * and to Modex Trust, which is what makes a later report investigable.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    return NextResponse.json(
      await apiSend<unknown>('POST', `/conversations/${encodeURIComponent(id)}/close`, token),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

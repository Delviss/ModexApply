import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Sends a message.
 *
 * The response carries the anti-scam verdict — `warning` for the student,
 * `senderNotice` for whoever wrote it — because the scan runs inline on the
 * send path. The client renders what comes back rather than deciding anything
 * itself; nothing about moderation is client-side.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to send a message.' } }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const body: unknown = await request.json();
    return NextResponse.json(
      await apiSend<unknown>('POST', `/conversations/${encodeURIComponent(id)}/messages`, token, body),
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

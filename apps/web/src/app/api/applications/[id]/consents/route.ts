import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Records the three consents.
 *
 * Forwarded verbatim rather than normalised here. The API holds the list of
 * consents a submission needs and refuses a partial set; a browser-side
 * "helpfully" filling in a missing one would be the bundled checkbox this
 * design explicitly rejects, wearing a different hat.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  const { id } = await params;
  try {
    const body: unknown = await request.json();
    return NextResponse.json(
      await apiSend<unknown>('POST', `/applications/${id}/consents`, token, body),
    );
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

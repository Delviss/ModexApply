import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/** `draft → ready`. The API re-checks; this only forwards. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  const { id } = await params;
  try {
    return NextResponse.json(
      await apiSend<unknown>('POST', `/applications/${id}/ready`, token),
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

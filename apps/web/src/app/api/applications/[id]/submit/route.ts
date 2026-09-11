import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Submission.
 *
 * The idempotency key comes from the browser and is **reused across retries of
 * the same click** — that is the entire point. A key minted here per request
 * would make every retry a fresh submission as far as the platform's duplicate
 * guard is concerned, which is exactly the failure the header exists to stop.
 * The client sends it; this forwards it unchanged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json(
      { error: { message: 'Sign in to submit an application.' } },
      { status: 401 },
    );
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey === null || idempotencyKey.trim() === '') {
    return NextResponse.json(
      { error: { message: 'This submission is missing its idempotency key.' } },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const body: unknown = await request.json().catch(() => ({}));
    return NextResponse.json(
      await apiSend<unknown>('POST', `/applications/${id}/submit`, token, body, {
        idempotencyKey,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { message: error.message, code: error.code, details: error.details } },
        { status: error.status },
      );
    }
    throw error;
  }
}

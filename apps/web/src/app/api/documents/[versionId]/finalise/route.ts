import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/** Confirms the bytes landed and matched, which is what queues the malware scan. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to upload a document.' } }, { status: 401 });
  }

  const { versionId } = await params;
  try {
    const body: unknown = await request.json();
    const result = await apiSend<unknown>(
      'POST',
      `/documents/versions/${versionId}/finalise`,
      token,
      body,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

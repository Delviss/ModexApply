import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Starts an upload on the student's behalf.
 *
 * A thin proxy, and it exists for one reason: the session token is in an
 * httpOnly cookie, so the browser cannot call the API directly with it. Adding
 * the token here keeps it out of client JavaScript, where an XSS on any page
 * would otherwise be able to read it.
 *
 * The file itself does not come through here — the response carries a signed
 * URL and the browser PUTs straight to storage.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in to upload a document.' } }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    const started = await apiSend<{ version: { id: string }; upload: unknown }>(
      'POST',
      '/documents/versions',
      token,
      body,
    );
    return NextResponse.json({ versionId: started.version.id, upload: started.upload });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

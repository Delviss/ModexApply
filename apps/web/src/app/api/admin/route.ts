import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Console writes, proxied.
 *
 * One route rather than a file per action, because every console write is the
 * same shape — a path under `/admin/**` and a JSON body — and a dozen
 * near-identical route files is a dozen places to forget the token check.
 *
 * The path is constrained to `/admin/` so this cannot be turned into a general
 * proxy for any API route by a client that fancies one.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  const body = (await request.json()) as { path?: unknown; body?: unknown };
  const path = typeof body.path === 'string' ? body.path : '';
  if (!path.startsWith('/admin/') || path.includes('..')) {
    return NextResponse.json(
      { error: { message: 'That is not a console action.' } },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await apiSend<unknown>('POST', path, token, body.body ?? {}));
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

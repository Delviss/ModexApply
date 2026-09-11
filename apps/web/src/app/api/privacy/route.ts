import { NextResponse } from 'next/server';
import { ApiError, apiSend } from '@/lib/api';
import { sessionToken } from '@/lib/session';

/**
 * Export and erasure, proxied so the session token stays out of the browser.
 *
 * `action` is checked against a fixed list rather than forwarded as a path
 * fragment: a route that takes a caller-supplied path is a proxy for the whole
 * API, and this one is for two operations.
 */
const ACTIONS = { export: '/me/privacy/export', erasure: '/me/privacy/erasure' } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  }

  const body = (await request.json()) as { action?: unknown; body?: unknown };
  const action = typeof body.action === 'string' ? body.action : '';
  if (!(action in ACTIONS)) {
    return NextResponse.json({ error: { message: 'Unknown action.' } }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await apiSend<unknown>('POST', ACTIONS[action as keyof typeof ACTIONS], token, body.body ?? {}),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MfaForm } from '@/components/mfa-form';
import { isSignedIn } from '@/lib/session';

export const metadata: Metadata = { title: 'Two-factor authentication', robots: { index: false } };

function safeNext(next: string | undefined): string {
  if (next === undefined) return '/admin';
  if (!next.startsWith('/') || next.startsWith('//')) return '/admin';
  return next;
}

/**
 * The staff second factor.
 *
 * Reachable only with a session already in hand — there is nothing to challenge
 * otherwise — and that session can do nothing else until this succeeds.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!(await isSignedIn())) redirect('/login');
  const { next } = await searchParams;

  return (
    <main className="mx-login">
      <MfaForm next={safeNext(next)} />
    </main>
  );
}

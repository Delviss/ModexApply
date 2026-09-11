import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, CardHeader } from '@modex/ui';
import { loadConsole } from '@/lib/console';
import { consoleMeta } from '@/components/console-shell';

export const metadata: Metadata = {
  title: 'Consoles',
  robots: { index: false },
};

/**
 * The console picker.
 *
 * Deliberately not a redirect to whichever console the actor holds. An operator
 * with two consoles needs to choose, and somebody who lands here with none
 * needs to be told that plainly rather than bounced between 403s.
 */
export default async function AdminIndexPage() {
  const state = await loadConsole(async () => null);

  if (state.status === 'signed_out') {
    return (
      <main className="mx-page">
        <Alert tone="warning" title="Sign in to continue">
          The admin consoles need a staff account. <Link href="/login">Sign in</Link>.
        </Alert>
      </main>
    );
  }

  if (state.status === 'mfa_required') {
    return (
      <main className="mx-page">
        <Alert tone="warning" title="Multi-factor authentication required">
          Every staff role needs a second factor. <Link href="/login/mfa">Enter your code</Link>.
        </Alert>
      </main>
    );
  }

  if (state.status !== 'ready') {
    return (
      <main className="mx-page">
        <Alert tone="warning" title="This account has no console">
          {'message' in state ? state.message : 'Ask an administrator for access.'}
        </Alert>
      </main>
    );
  }

  const { session } = state;

  return (
    <main className="mx-page" style={{ display: 'grid', gap: 'var(--mx-space-4)' }}>
      <h1>Consoles</h1>
      {session.consoles.length === 0 ? (
        <Alert tone="warning" title="No console for this account">
          Your roles ({session.roles.join(', ') || 'none'}) do not include a staff console. If that
          is wrong, an administrator at your institution can grant it.
        </Alert>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {session.consoles.map((name) => {
            const meta = consoleMeta(name);
            return (
              <Card key={name} padding="lg">
                <CardHeader title={<Link href={meta.href}>{meta.label}</Link>} description={meta.blurb} />
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

import Link from 'next/link';
import { Alert } from '@modex/ui';

/**
 * What a console renders when it cannot render itself.
 *
 * Each state names its remedy. "Forbidden" with no next step is how an operator
 * ends up filing a support ticket about a rule that is working correctly.
 */
export function ConsoleFallback({ state, message }: { state: string; message?: string }) {
  return (
    <main className="mx-page">
      <Alert
        tone={state === 'blocked' ? 'warning' : 'warning'}
        title={
          state === 'signed_out'
            ? 'Your session has ended'
            : state === 'mfa_required'
              ? 'Multi-factor authentication required'
              : state === 'blocked'
                ? 'This institution cannot open the portal yet'
                : 'This console is not available to your account'
        }
      >
        {state === 'signed_out' ? (
          <>
            <Link href="/login">Sign in</Link> to continue.
          </>
        ) : state === 'mfa_required' ? (
          <>
            Every staff role needs a second factor.{' '}
            <Link href="/login/mfa">Enter the code from your authenticator</Link>.
          </>
        ) : (
          (message ?? 'Ask an administrator at your institution for access.')
        )}
      </Alert>
    </main>
  );
}

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Alert, Button } from '@modex/ui';

/**
 * Route error boundary.
 *
 * Without this, a page whose API call fails renders Next's default error
 * screen. That is the wrong thing to show on a platform whose whole premise is
 * that a student can tell what is true: a bare "Application error" leaves them
 * unable to distinguish "this university does not exist" from "our systems are
 * briefly down", and the first reading is the damaging one.
 *
 * So the copy says which it is, and says explicitly that nothing about their
 * application has been lost.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only safe handle on the underlying error: Next strips
    // the message in production precisely so it cannot leak. Logging it client
    // side lets support tie a report back to the server log line.
    console.error('Route error', { digest: error.digest });
  }, [error]);

  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: 'var(--mx-space-16) var(--mx-space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--mx-space-4)',
      }}
    >
      <Alert tone="danger" title="We could not load this page">
        <p style={{ margin: 0 }}>
          Something on our side failed, not on yours. This is not a sign that the university or the
          programme has gone away, and nothing about your application has been lost.
        </p>
      </Alert>

      <div style={{ display: 'flex', gap: 'var(--mx-space-3)', flexWrap: 'wrap' }}>
        <Button onClick={reset}>Try again</Button>
        <Link className="mx-button" data-variant="secondary" data-size="md" href="/">
          Back to the start
        </Link>
      </div>

      {error.digest !== undefined ? (
        <p style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)', margin: 0 }}>
          If you contact us about this, quote reference <code>{error.digest}</code>.
        </p>
      ) : null}
    </main>
  );
}

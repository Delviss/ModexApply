'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardHeader, Field, Input } from '@modex/ui';

/**
 * The staff second factor: enrol, then challenge.
 *
 * Both live in one component because they are one moment for the person doing
 * them — a new administrator signs in, has no authenticator, and needs to leave
 * this page with a working one. Splitting them across two routes would mean a
 * half-enrolled account with nowhere to go.
 *
 * The secret is shown once, in text, next to the URI. No QR code image: adding
 * an image dependency to render a string that every authenticator also accepts
 * by hand is not a trade worth making, and a copyable string works on the
 * phone people are already holding.
 */
export function MfaForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUrl: string } | null>(null);

  async function begin(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/mfa/enrol', { method: 'POST' });
      const body = (await response.json()) as {
        secret?: string;
        otpauthUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || body.secret === undefined || body.otpauthUrl === undefined) {
        throw new Error(body.error?.message ?? 'We could not start enrolment.');
      }
      setEnrolment({ secret: body.secret, otpauthUrl: body.otpauthUrl });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not start enrolment.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (enrolment !== null) {
        const confirm = await fetch('/api/mfa/enrol', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: code.trim() }),
        });
        if (!confirm.ok) {
          const body = (await confirm.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(body?.error?.message ?? 'That code did not match.');
        }
      }

      const response = await fetch('/api/mfa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? 'That code did not match.');
      }

      router.push(next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That code did not match.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="lg">
      <CardHeader
        title="Two-factor authentication"
        description="Every staff role needs a second factor. Enter the six-digit code from your authenticator app."
      />

      {error === null ? null : (
        <Alert tone="danger" title="That did not work">
          {error}
        </Alert>
      )}

      {enrolment === null ? null : (
        <Alert tone="info" title="Add this to your authenticator">
          <p>
            Scan or paste this secret, then enter the code it produces. It is shown once and cannot
            be retrieved again.
          </p>
          <p>
            <code>{enrolment.secret}</code>
          </p>
          <p style={{ wordBreak: 'break-all', fontSize: 'var(--mx-text-xs)' }}>
            {enrolment.otpauthUrl}
          </p>
        </Alert>
      )}

      <form onSubmit={(event) => void submit(event)} className="mx-login__fields">
        <Field label="Six-digit code" required>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              required
            />
          )}
        </Field>

        <Button type="submit" disabled={busy || code.trim().length < 6}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </form>

      {enrolment === null ? (
        <p style={{ marginTop: 'var(--mx-space-4)' }}>
          <Button variant="secondary" onClick={() => void begin()} disabled={busy}>
            I have no authenticator yet
          </Button>
        </p>
      ) : null}
    </Card>
  );
}

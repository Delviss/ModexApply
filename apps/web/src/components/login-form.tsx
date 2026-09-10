'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@modex/ui';

export interface LoginFormProps {
  next?: string;
}

/**
 * Only a same-site path is followed after sign-in.
 *
 * `next` arrives from the query string, so anything absolute — `//evil.example`
 * included, which browsers treat as protocol-relative — is discarded in favour
 * of the dashboard. A sign-in page that redirects wherever it is told is a
 * phishing tool with our domain on it.
 */
function safeNext(next: string | undefined): string {
  if (next === undefined) return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        // Deliberately not "no account with that email": that distinction tells
        // an attacker which addresses are registered here.
        throw new Error(body?.error?.message ?? 'That email and password did not match.');
      }

      router.push(safeNext(next));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mx-login__fields">
      {error === null ? null : (
        <Alert tone="danger" title="We could not sign you in">
          {error}
        </Alert>
      )}

      <Field label="Email" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>

      <Field label="Password" required>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>

      <Button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

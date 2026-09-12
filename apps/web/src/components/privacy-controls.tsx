'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, DangerConfirm } from '@modex/ui';

/**
 * Export and erasure, from the student's side.
 *
 * The export is handed over as a file the browser saves, built from the JSON
 * the API returns — there is no server-side artefact to leave lying around, and
 * nothing to expire.
 *
 * Erasure reuses `<DangerConfirm>`, the same component the trust console uses
 * to suspend somebody. That is deliberate: this is the most destructive thing
 * on the site, and it should feel like it.
 */
export function PrivacyControls({ retained }: { retained: { explanation: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  async function post(action: 'export' | 'erasure', body?: unknown): Promise<unknown> {
    const response = await fetch('/api/privacy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, body }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = (payload as { error?: { message?: string } }).error?.message;
      throw new Error(message ?? 'That did not work.');
    }
    return payload;
  }

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await post('export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `modex-apply-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not build your export.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title="Your account has been closed">
        Your profile, documents and saved searches are gone. What we had to keep is listed above,
        with the reason. You have been signed out everywhere.
      </Alert>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-3)' }}>
      {error === null ? null : (
        <Alert tone="danger" title="That did not work">
          {error}
        </Alert>
      )}

      <div style={{ display: 'flex', gap: 'var(--mx-space-3)', flexWrap: 'wrap' }}>
        <Button onClick={() => void download()} disabled={busy}>
          {busy ? 'Building your file…' : 'Download everything we hold'}
        </Button>
        <Button variant="destructive" onClick={() => setConfirming(true)} disabled={busy}>
          Delete my account
        </Button>
      </div>

      {confirming ? (
        <DangerConfirm
          title="Delete your account"
          consequences={
            <>
              <p>
                Your profile, uploaded files, shortlists and saved searches are deleted. Your sign-in
                is removed and every device is signed out. This cannot be undone.
              </p>
              <p>What we have to keep, and why:</p>
              <ul>
                {retained.map((row) => (
                  <li key={row.explanation}>{row.explanation}</li>
                ))}
              </ul>
            </>
          }
          confirmPhrase="DELETE MY ACCOUNT"
          submitLabel="Delete my account"
          onCancel={() => setConfirming(false)}
          onConfirm={async (reason) => {
            await post('erasure', { confirm: 'DELETE MY ACCOUNT', reason });
            setDone(true);
            setConfirming(false);
            await fetch('/api/session', { method: 'DELETE' });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

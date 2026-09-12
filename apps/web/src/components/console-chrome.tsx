'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, DangerConfirm, ImpersonationBanner, StepUpInterstitial } from '@modex/ui';
import type { StepUpAction } from '@modex/contracts';

/**
 * The client-side chrome every console shares (Phase 6).
 *
 * Three pieces, each of which exists because a console is a place where
 * somebody is about to do something to somebody else's record:
 *
 * - `StepUpGate` — the full-screen "confirm it is you", rendered *instead of*
 *   the console rather than over it. There is no way past it that leaves the
 *   page behind it readable, because a queue you can read while ignoring the
 *   prompt is a queue the prompt did not protect.
 * - `ConsoleImpersonationBanner` — the persistent warning, at the top of every
 *   console page, whenever this session is a support visit.
 * - `ConsoleAction` — a button that posts a console write and refreshes the
 *   server render, with the failure shown next to the button rather than in a
 *   toast that has scrolled away by the time it is read.
 */

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, body }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(payload?.error?.message ?? 'That did not work.');
  }
}

export function StepUpGate({
  purpose,
  action,
  ttlMinutes,
}: {
  purpose: string;
  action: StepUpAction;
  ttlMinutes: number;
}) {
  const router = useRouter();

  return (
    <StepUpInterstitial
      purpose={purpose}
      ttlMinutes={ttlMinutes}
      onSubmit={async (code) => {
        const response = await fetch('/api/step-up', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, action }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(payload?.error?.message ?? 'That code did not match.');
        }
        // The server render is what decides what this operator may see, so the
        // page is re-fetched rather than optimistically revealed.
        router.refresh();
      }}
      onSignOut={() => {
        void fetch('/api/session', { method: 'DELETE' }).then(() => router.push('/login'));
      }}
    />
  );
}

export function ConsoleImpersonationBanner({
  operator,
  subject,
  expiresAt,
  reference,
  grantId,
}: {
  operator: string;
  subject: string;
  expiresAt: string;
  reference?: string;
  grantId?: string;
}) {
  const router = useRouter();
  return (
    <ImpersonationBanner
      operator={operator}
      subject={subject}
      expiresAt={expiresAt}
      reference={reference}
      audience="operator"
      action={
        grantId === undefined ? undefined : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void post(`/admin/ops/impersonations/${grantId}/end`, {
                reason: 'Ended from the banner.',
              }).then(() => router.refresh());
            }}
          >
            End now
          </Button>
        )
      }
    />
  );
}

export function ConsoleAction({
  path,
  body,
  label,
  variant = 'secondary',
  disabledReason,
  confirm,
}: {
  path: string;
  body?: unknown;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  /**
   * Renders the control disabled with the reason beneath it. The server
   * enforces the same rule; this is so the operator is told *why* rather than
   * discovering it by being refused.
   */
  disabledReason?: string | null;
  /** Turns the action into a typed confirmation with a mandatory reason. */
  confirm?: { title: string; consequences: ReactNode; phrase: string; submitLabel: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run(reason?: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload =
        reason === undefined ? body : { ...(body as Record<string, unknown>), reason };
      await post(path, payload);
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  if (disabledReason != null && disabledReason !== '') {
    return (
      <span>
        <Button variant={variant} size="sm" disabled>
          {label}
        </Button>
        <span className="mx-approval-blocked">{disabledReason}</span>
      </span>
    );
  }

  return (
    <span>
      <Button
        variant={variant}
        size="sm"
        disabled={busy}
        onClick={() => {
          if (confirm !== undefined) {
            setConfirming(true);
            return;
          }
          void run().catch(() => undefined);
        }}
      >
        {busy ? 'Working…' : label}
      </Button>
      {error === null ? null : (
        <span className="mx-approval-blocked" role="alert">
          {error}
        </span>
      )}
      {confirming && confirm !== undefined ? (
        <DangerConfirm
          title={confirm.title}
          consequences={confirm.consequences}
          confirmPhrase={confirm.phrase}
          submitLabel={confirm.submitLabel}
          onCancel={() => setConfirming(false)}
          onConfirm={run}
        />
      ) : null}
    </span>
  );
}

/** Shown where a console cannot load at all, with the remedy rather than a code. */
export function ConsoleNotice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  return <Alert tone={tone}>{children}</Alert>;
}

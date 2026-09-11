'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, RadioGroup } from '@modex/ui';

export interface StartableIntake {
  id: string;
  label: string;
  hint: string;
  open: boolean;
}

/**
 * Starting an application.
 *
 * A POST, deliberately — creating an application is a mutation, and a link that
 * created one on GET would mean a prefetch, a crawler or a back button could
 * start applications on a student's behalf.
 *
 * The "you already have one" case is not an error to recover from: the API
 * answers `409` with the existing application's id, and the friendliest correct
 * thing to do is take the student to it.
 */
export function StartApplication({
  programKey,
  intakes,
}: {
  programKey: string;
  intakes: StartableIntake[];
}) {
  const router = useRouter();
  const openIntakes = intakes.filter((intake) => intake.open);
  const [intakeId, setIntakeId] = useState<string>(openIntakes[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(): Promise<void> {
    if (intakeId === '') return;
    setBusy(true);
    setError(null);

    const response = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programKey, intakeId }),
    });

    if (response.ok) {
      const created = (await response.json()) as { id: string };
      router.push(`/applications/${created.id}`);
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; details?: { applicationId?: string } } }
      | null;
    const existing = payload?.error?.details?.applicationId;
    if (typeof existing === 'string') {
      router.push(`/applications/${existing}`);
      return;
    }

    setBusy(false);
    if (response.status === 401) {
      router.push(`/login?next=/programmes/${programKey}/apply`);
      return;
    }
    setError(payload?.error?.message ?? 'We could not start an application for you.');
  }

  if (openIntakes.length === 0) {
    return (
      <Alert tone="warning" title="No intake is open">
        Every intake for this programme is closed or cancelled, so there is nothing to apply to
        right now. Deadlines come from the university and we do not extend them.
      </Alert>
    );
  }

  return (
    <div className="mx-start-application">
      {error === null ? null : (
        <Alert tone="danger" title="We could not start it">
          {error}
        </Alert>
      )}

      <RadioGroup
        legend="Which intake are you applying for?"
        name="intake"
        value={intakeId}
        onChange={setIntakeId}
        options={openIntakes.map((intake) => ({
          value: intake.id,
          label: intake.label,
          hint: intake.hint,
        }))}
      />

      <Button variant="primary" size="lg" onClick={() => void start()} disabled={busy}>
        {busy ? 'Starting…' : 'Start this application'}
      </Button>

      <p className="mx-card__description">
        Starting an application does not send anything. You review everything, give consent for
        each part separately, and press send yourself.
      </p>
    </div>
  );
}

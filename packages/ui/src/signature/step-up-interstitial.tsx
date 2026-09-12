'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../primitives/button.js';
import { Field, Input } from '../primitives/field.js';
import { ShieldCheckIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<StepUpInterstitial>` — "confirm it is you", full screen (Phase 6 design
 * spec).
 *
 * **A full-screen interstitial, not a dismissible modal**, and the distinction
 * is the whole design: there is no close button, no backdrop click, and no
 * escape key handler. The only ways out are a correct code and signing out.
 * A step-up prompt somebody can dismiss is a step-up prompt that gets dismissed.
 *
 * It explains *what it is about to let you do* rather than just asking for a
 * code. "Confirm it is you" with no object teaches operators to type six digits
 * at anything that asks — which is the phishing pattern this control is
 * supposed to resist.
 */
export interface StepUpInterstitialProps {
  /** What the step-up is for, in the operator's language. */
  purpose: string;
  /** Minutes the elevation lasts once granted. */
  ttlMinutes: number;
  /** Resolves when the code is accepted; rejects with a message to show. */
  onSubmit: (code: string) => Promise<void>;
  /** Signing out is the only other way forward. */
  onSignOut?: () => void;
  className?: string;
}

export function StepUpInterstitial({
  purpose,
  ttlMinutes,
  onSubmit,
  onSignOut,
  className,
}: StepUpInterstitialProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That code did not match.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn('mx-stepup', className)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mx-stepup-title"
    >
      <div className="mx-stepup__panel">
        <span className="mx-stepup__icon" aria-hidden="true">
          <ShieldCheckIcon size={28} />
        </span>
        <h1 className="mx-stepup__title" id="mx-stepup-title">
          Confirm it is you
        </h1>
        <p className="mx-stepup__purpose">{purpose}</p>

        <form onSubmit={submit} className="mx-stepup__form">
          <Field
            label="Code from your authenticator"
            hint={`This confirmation lasts ${ttlMinutes} minutes.`}
            error={error}
            required
          >
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                // Six digits, and the field says so rather than failing after.
                maxLength={6}
                pattern="[0-9]{6}"
                required
              />
            )}
          </Field>
          <Button type="submit" disabled={busy || code.trim().length < 6}>
            {busy ? 'Checking…' : 'Confirm'}
          </Button>
        </form>

        {onSignOut === undefined ? null : (
          <button type="button" className="mx-stepup__signout" onClick={onSignOut}>
            Sign out instead
          </button>
        )}
      </div>
    </div>
  );
}

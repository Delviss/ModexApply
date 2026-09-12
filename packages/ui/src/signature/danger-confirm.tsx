'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../primitives/button.js';
import { Field, Input, Textarea } from '../primitives/field.js';
import { AlertTriangleIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<DangerConfirm>` — typed confirmation plus a mandatory reason, for the
 * actions that take something away from somebody (Phase 6 design spec).
 *
 * Two gates, and they do different jobs. The **typed phrase** defeats the
 * muscle memory of clicking through a dialog; the **reason** is what the person
 * on the other end of the sanction reads when they appeal. Neither substitutes
 * for the other, which is why a confirm-only version of this component does not
 * exist.
 *
 * The reason has a minimum length because "abuse" is not a reason anybody can
 * act on — not the person sanctioned, not the colleague reviewing it later.
 */
export interface DangerConfirmProps {
  /** The action, named as a verb phrase: "Suspend this guide". */
  title: string;
  /** What will actually happen, concretely. */
  consequences: ReactNode;
  /** The phrase the operator has to type. Usually the target's name. */
  confirmPhrase: string;
  submitLabel: string;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
  minReasonLength?: number;
  className?: string;
}

export function DangerConfirm({
  title,
  consequences,
  confirmPhrase,
  submitLabel,
  onConfirm,
  onCancel,
  minReasonLength = 10,
  className,
}: DangerConfirmProps) {
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phraseMatches = typed.trim() === confirmPhrase;
  const reasonLongEnough = reason.trim().length >= minReasonLength;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!phraseMatches || !reasonLongEnough) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('mx-danger-confirm', className)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form className="mx-danger-confirm__panel" onSubmit={submit}>
        <h2 className="mx-danger-confirm__title" id={titleId}>
          <span aria-hidden="true">
            <AlertTriangleIcon size={18} />
          </span>
          {title}
        </h2>
        <div className="mx-danger-confirm__consequences">{consequences}</div>

        <Field label={`Type ${confirmPhrase} to confirm`} required>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              required
            />
          )}
        </Field>

        <Field
          label="Reason"
          hint="Recorded against this action, and shown to whoever reviews it."
          error={error}
          required
        >
          {({ inputId, describedBy, invalid }) => (
            <Textarea
              id={inputId}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              required
              minLength={minReasonLength}
            />
          )}
        </Field>

        <div className="mx-danger-confirm__actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={busy || !phraseMatches || !reasonLongEnough}>
            {busy ? 'Working…' : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

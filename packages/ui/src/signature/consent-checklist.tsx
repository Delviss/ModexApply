import { SUBMISSION_CONSENTS, type SubmissionConsentId } from '@modex/contracts';
import { Checkbox } from '../primitives/choice.js';
import { cn } from '../lib/cn.js';

/**
 * `<ConsentChecklist>` — the consent step, built rather than sourced.
 *
 * There is no vendor block for this and there should not be, because every
 * property that matters is a property the usual "I agree to the terms" pattern
 * gets wrong:
 *
 *  - **Individually worded.** Three sentences a person can disagree with
 *    separately, not one sentence covering three unrelated things.
 *  - **Individually checked.** Consent to send an application is not consent to
 *    share documents, and neither is consent to be contacted.
 *  - **Never pre-checked.** A pre-checked box records that a page loaded, not
 *    that a person decided.
 *  - **No "select all".** It would recreate the bundled checkbox with extra
 *    steps.
 *
 * The list comes from `SUBMISSION_CONSENTS` in the contracts package, which is
 * the same list the API checks before it will build a payload. A consent step
 * the server does not enforce is decoration.
 */
export interface ConsentChecklistProps {
  institutionName: string;
  documentCount: number;
  accepted: readonly SubmissionConsentId[];
  onChange: (id: SubmissionConsentId, accepted: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ConsentChecklist({
  institutionName,
  documentCount,
  accepted,
  onChange,
  disabled = false,
  className,
}: ConsentChecklistProps) {
  return (
    <fieldset className={cn('mx-consents', className)}>
      <legend className="mx-consents__legend">What you are agreeing to</legend>
      <p className="mx-consents__intro">
        Each of these is a separate decision. Tick the ones you agree to; all three are needed
        before we can send anything to {institutionName}.
      </p>

      <ul className="mx-consents__list">
        {SUBMISSION_CONSENTS.map((consent) => (
          <li key={consent.id} className="mx-consents__item">
            <Checkbox
              // Never defaulted, and controlled rather than uncontrolled: the
              // absence of a decision is not a decision, and a box that
              // remembered its own state across a re-render would be a box that
              // can disagree with what the server was told.
              checked={accepted.includes(consent.id)}
              onChange={(event) => onChange(consent.id, event.currentTarget.checked)}
              disabled={disabled}
              label={consent.title}
            />
            <p className="mx-consents__body">
              {consent.body
                .replaceAll('{institution}', institutionName)
                .replaceAll('{documentCount}', String(documentCount))}
            </p>
          </li>
        ))}
      </ul>

      <p className="mx-consents__footnote">
        You can withdraw any of these later from your privacy settings. Withdrawing after an
        application has been sent does not un-send it — the university already holds a copy, and we
        will tell you who to contact there.
      </p>
    </fieldset>
  );
}

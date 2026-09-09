import { useCallback, useState, type ReactNode } from 'react';
import { Button } from '../primitives/button.js';
import { usePrefersReducedMotion } from '../lib/motion.js';
import { cn } from '../lib/cn.js';

/**
 * Wizard Steps — re-themed from `@ddoemonn/wizard-steps`.
 *
 * Clickable progress rail with keyboard navigation and a completion state. The
 * vendor block animates step transitions with Framer Motion; here the transition
 * is a CSS opacity fade bound to `--mx-motion-surface`, which the token layer
 * collapses to 1ms under `prefers-reduced-motion` — and the hook below skips it
 * outright, so neither layer is load-bearing on its own.
 *
 * A step is only reachable once every step before it validates. That is a
 * product rule, not a nicety: the partner onboarding wizard must not let an
 * institution reach "sign contract" with an unconfirmed domain.
 */

export interface WizardStep {
  id: string;
  title: string;
  description?: ReactNode;
  render: () => ReactNode;
  /** Return null when the step is complete, or a message explaining what is missing. */
  validate?: () => string | null;
}

export interface WizardStepsProps {
  steps: readonly WizardStep[];
  onComplete?: () => void;
  completeLabel?: string;
  className?: string;
}

export function WizardSteps({
  steps,
  onComplete,
  completeLabel = 'Submit',
  className,
}: WizardStepsProps) {
  const [index, setIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [furthestReached, setFurthestReached] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  const current = steps[index];

  const validateStep = useCallback(
    (stepIndex: number): boolean => {
      const step = steps[stepIndex];
      if (step?.validate === undefined) return true;
      const message = step.validate();
      setErrors((previous) => {
        const next = { ...previous };
        if (message === null) delete next[step.id];
        else next[step.id] = message;
        return next;
      });
      return message === null;
    },
    [steps],
  );

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= steps.length) return;
      // Moving forward requires every intervening step to validate.
      if (target > index) {
        for (let i = index; i < target; i += 1) {
          if (!validateStep(i)) {
            setIndex(i);
            return;
          }
        }
      }
      setIndex(target);
      setFurthestReached((furthest) => Math.max(furthest, target));
    },
    [index, steps.length, validateStep],
  );

  const statusFor = (stepIndex: number): 'done' | 'active' | 'error' | 'pending' => {
    const step = steps[stepIndex];
    if (step !== undefined && errors[step.id] !== undefined) return 'error';
    if (stepIndex === index) return 'active';
    if (stepIndex < index) return 'done';
    return 'pending';
  };

  if (current === undefined) return null;

  return (
    <div className={cn('mx-wizard', className)}>
      <ol className="mx-wizard__rail">
        {steps.map((step, stepIndex) => (
          <li key={step.id} className="mx-wizard__step" data-status={statusFor(stepIndex)}>
            <button
              type="button"
              className="mx-wizard__step-button"
              aria-current={stepIndex === index ? 'step' : undefined}
              disabled={stepIndex > furthestReached + 1}
              onClick={() => goTo(stepIndex)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') goTo(stepIndex + 1);
                if (event.key === 'ArrowLeft') goTo(stepIndex - 1);
              }}
            >
              <span className="mx-wizard__step-index">
                Step {stepIndex + 1} of {steps.length}
              </span>
              <span className="mx-wizard__step-title">{step.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <div
        className="mx-wizard__panel"
        style={reducedMotion ? { transition: 'none' } : undefined}
        role="group"
        aria-label={current.title}
      >
        {current.description ? <p className="mx-card__description">{current.description}</p> : null}
        {current.render()}
        {errors[current.id] !== undefined ? (
          <p className="mx-field__error" role="alert">
            {errors[current.id]}
          </p>
        ) : null}
      </div>

      <div className="mx-wizard__footer">
        <Button variant="secondary" onClick={() => goTo(index - 1)} disabled={index === 0}>
          Back
        </Button>
        {index === steps.length - 1 ? (
          <Button
            onClick={() => {
              if (validateStep(index)) onComplete?.();
            }}
          >
            {completeLabel}
          </Button>
        ) : (
          <Button onClick={() => goTo(index + 1)}>Continue</Button>
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import type { StageStatus } from '@modex/contracts';
import { AlertTriangleIcon, CheckIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * Task Steps — re-themed from `@ddoemonn/task-steps`.
 *
 * The vendor block's state colours are rebound to `--mx-success` (done),
 * `--mx-action` (active), `--mx-ink-500` (pending) and `--mx-danger` (error).
 * The **error** state is the reason this block was picked over a plain stepper:
 * a failed submission or a failed verification stage has to be legible as a
 * failure, not as an unfinished step.
 */

export interface TaskStep {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status: StageStatus;
}

export interface TaskStepsProps {
  steps: readonly TaskStep[];
  className?: string;
  'aria-label'?: string;
}

const STATUS_TEXT: Record<StageStatus, string> = {
  pending: 'Not started',
  active: 'In progress',
  done: 'Complete',
  error: 'Failed',
};

export function TaskSteps({ steps, className, ...props }: TaskStepsProps) {
  return (
    <ol className={cn('mx-task-steps', className)} aria-label={props['aria-label'] ?? 'Progress'}>
      {steps.map((step, index) => (
        <li key={step.id} className="mx-task-step" data-status={step.status}>
          <span className="mx-task-step__marker" aria-hidden="true">
            {step.status === 'done' ? (
              <CheckIcon size={12} />
            ) : step.status === 'error' ? (
              <AlertTriangleIcon size={12} />
            ) : (
              index + 1
            )}
          </span>
          <span className="mx-task-step__body">
            <span className="mx-task-step__title">
              {step.title}
              {/* State reaches assistive tech as words, not as a colour. */}
              <span className="mx-visually-hidden"> — {STATUS_TEXT[step.status]}</span>
            </span>
            {step.description ? (
              <span className="mx-task-step__description">{step.description}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

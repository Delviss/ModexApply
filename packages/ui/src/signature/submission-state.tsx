import type { ReactNode } from 'react';
import {
  isSynchronousConnector,
  submissionDisplayState,
  submissionHeadline,
  type ApplicationState,
  type ConnectorType,
  type SubmissionDisplayState,
} from '@modex/contracts';
import { Badge, type BadgeTone } from '../primitives/badge.js';
import { AlertTriangleIcon, CheckIcon, ClockIcon, InfoIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<SubmissionState>` — **the single highest-risk piece of UI in the product.**
 *
 * A student who believes an application was submitted when it was not has been
 * actively harmed, so this component has one job: never let the four states
 * blur into each other.
 *
 * | State | Token | Copy |
 * |---|---|---|
 * | not submitted | `--mx-ink-500` | `Not yet submitted` |
 * | sending | `--mx-info` | `Sending to <University>` — **never "Submitted"** |
 * | confirmed | `--mx-success` | `Submitted · confirmed by <University>` + the reference |
 * | failed | `--mx-danger` | `Submission failed` + what happened + the next step |
 *
 * Two decisions worth keeping:
 *
 * 1. **The copy is not a prop.** `submissionHeadline` in the contracts package
 *    produces it from the state and the external reference, so "a
 *    `submitted_pending` application must not display Submitted" is a unit test
 *    rather than a code-review convention. A caller cannot pass a nicer word.
 * 2. **Sending reads differently per connector.** On an API connector, minutes
 *    in `sending` means something is wrong. On a portal handoff, it is the
 *    normal state of affairs and saying otherwise would be a lie. Same state,
 *    different sentence.
 */

const PRESENTATION: Record<
  SubmissionDisplayState,
  { tone: BadgeTone; Icon: typeof CheckIcon; announce: 'polite' | 'assertive' }
> = {
  not_submitted: { tone: 'neutral', Icon: InfoIcon, announce: 'polite' },
  sending: { tone: 'info', Icon: ClockIcon, announce: 'polite' },
  confirmed: { tone: 'success', Icon: CheckIcon, announce: 'polite' },
  // A failure is the one state worth interrupting a screen-reader user for.
  failed: { tone: 'danger', Icon: AlertTriangleIcon, announce: 'assertive' },
};

export interface SubmissionStateProps {
  state: ApplicationState;
  institutionName: string;
  /** The university's own reference. Never a Modex id, never invented. */
  externalRef?: string | null;
  connectorType?: ConnectorType | null;
  /** What happened and what to do about it. Required in practice on `failed`. */
  failureDetail?: { what: string; next: string } | null;
  children?: ReactNode;
  className?: string;
}

export function SubmissionState({
  state,
  institutionName,
  externalRef = null,
  connectorType = null,
  failureDetail = null,
  children,
  className,
}: SubmissionStateProps) {
  const display = submissionDisplayState(state);
  const { tone, Icon, announce } = PRESENTATION[display];
  const headline = submissionHeadline(state, institutionName, externalRef);

  return (
    <section
      className={cn('mx-submission', className)}
      data-display={display}
      aria-label="Submission status"
    >
      {/*
        The status is in a live region because it changes without a reload while
        the student is watching it — which is precisely when a sighted user gets
        the update for free and everyone else gets nothing.
      */}
      <p className="mx-submission__headline" role="status" aria-live={announce}>
        <Badge tone={tone} icon={<Icon size={12} />}>
          {headline}
        </Badge>
      </p>

      {display === 'sending' ? (
        <p className="mx-submission__detail">
          {connectorType !== null && !isSynchronousConnector(connectorType)
            ? `${institutionName} confirms applications on their own schedule rather than immediately. We will tell you the moment their reference arrives — you can close this page.`
            : 'Do not close this tab while this finishes. If you do, we will pick it up where it left off and tell you when the university confirms.'}
        </p>
      ) : null}

      {display === 'confirmed' && externalRef !== null ? (
        <p className="mx-submission__detail">
          {institutionName}&rsquo;s reference for this application is{' '}
          <span className="mx-submission__ref">{externalRef}</span>. Quote it in any contact with
          them.
        </p>
      ) : null}

      {display === 'confirmed' && externalRef === null ? (
        <p className="mx-submission__detail">
          {institutionName} has confirmed they received this application. They have not issued a
          reference number for it.
        </p>
      ) : null}

      {display === 'failed' && failureDetail !== null ? (
        <>
          <p className="mx-submission__detail">{failureDetail.what}</p>
          <p className="mx-submission__next">{failureDetail.next}</p>
        </>
      ) : null}

      {children}
    </section>
  );
}

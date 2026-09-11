import type { ReactNode } from 'react';
import type { ApplicationState } from '@modex/contracts';
import { formatDate } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * `<ApplicationTimeline>` — what happened to this application, and who did it.
 *
 * Built on the same vertical rail as `<TaskSteps>` but with one thing the
 * vendor block has no concept of: **attribution**. An event the university
 * reported is visually and textually theirs, not Modex's. Blurring that would
 * let "rejected" read as a Modex decision, which is both untrue and precisely
 * the confusion the agent model thrives on.
 *
 * The current node is `--mx-brand-600`, completed is `--mx-success`, pending is
 * `--mx-border-strong`, and a failure is `--mx-danger`.
 */
export type TimelineTone = 'done' | 'current' | 'pending' | 'error';

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  detail?: ReactNode;
  at?: string | Date | null;
  tone: TimelineTone;
  /** The university's name when the event came from them; `null` when it is ours. */
  attributedTo?: string | null;
}

export interface ApplicationTimelineProps {
  entries: readonly TimelineEntry[];
  /** Rendered as the accessible name; defaults to something useful. */
  label?: string;
  className?: string;
}

const TONE_TEXT: Record<TimelineTone, string> = {
  done: 'Complete',
  current: 'Happening now',
  pending: 'Not started',
  error: 'Failed',
};

export function ApplicationTimeline({ entries, label, className }: ApplicationTimelineProps) {
  return (
    <ol className={cn('mx-timeline', className)} aria-label={label ?? 'Application timeline'}>
      {entries.map((entry) => (
        <li key={entry.id} className="mx-timeline__entry" data-tone={entry.tone}>
          <span className="mx-timeline__marker" aria-hidden="true" />
          <div className="mx-timeline__body">
            <p className="mx-timeline__title">
              {entry.title}
              {/* State reaches assistive tech as words, never as a colour. */}
              <span className="mx-visually-hidden"> — {TONE_TEXT[entry.tone]}</span>
            </p>
            {entry.attributedTo == null ? null : (
              <p className="mx-timeline__attribution">Reported by {entry.attributedTo}</p>
            )}
            {entry.detail === undefined ? null : (
              <p className="mx-timeline__detail">{entry.detail}</p>
            )}
            {entry.at == null ? null : (
              <p className="mx-timeline__at">{formatDate(entry.at)}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The fixed spine every application has, with the states it has actually
 * reached marked off.
 *
 * Separate from the university's own events on purpose: this is the shape of
 * the journey, and those are things that happened. Interleaving them would make
 * a stalled application look like a finished one with a gap in the middle.
 */
export function spineFor(state: ApplicationState): TimelineEntry[] {
  const reached = (...states: ApplicationState[]) => states.includes(state);
  const past = (...states: ApplicationState[]) =>
    states.some((candidate) => ORDER.indexOf(state) > ORDER.indexOf(candidate));

  return [
    {
      id: 'prepare',
      title: 'Preparing your application',
      tone: reached('draft') ? 'current' : 'done',
    },
    {
      id: 'ready',
      title: 'Ready to send',
      tone: reached('ready') ? 'current' : past('ready') ? 'done' : 'pending',
    },
    {
      id: 'sending',
      title: 'Sending to the university',
      tone: reached('submitted_pending')
        ? 'current'
        : reached('failed')
          ? 'error'
          : past('submitted_pending')
            ? 'done'
            : 'pending',
    },
    {
      id: 'received',
      title: 'Received by the university',
      tone: reached('submitted') ? 'current' : past('submitted') ? 'done' : 'pending',
    },
    {
      id: 'decision',
      title: 'Decision',
      tone: reached('offer', 'rejected', 'accepted', 'declined', 'enrolled')
        ? 'done'
        : reached('under_review', 'more_info')
          ? 'current'
          : 'pending',
    },
  ];
}

/** Rough forward order, used only to decide what is behind the current state. */
const ORDER: ApplicationState[] = [
  'draft',
  'ready',
  'failed',
  'submitted_pending',
  'submitted',
  'under_review',
  'more_info',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'enrolled',
  'expired',
  'withdrawn',
];

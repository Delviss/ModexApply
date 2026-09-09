import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { InfoIcon } from '../primitives/icons.js';

/**
 * `<DisclosureNotice>` — surfaces commercial relationships wherever ranking or
 * recommendation is shown (Phase 0 §2.9).
 *
 * Modex exists because the agent model hides who is paying whom. A ranked list
 * with no disclosure is the same failure in a nicer interface, so this component
 * is required on any surface that orders, promotes or recommends — and it never
 * renders as a dismissible toast.
 */

export type DisclosureKind =
  | 'partnership'
  | 'paid_placement'
  | 'commission'
  | 'ranking_method'
  | 'guide_compensation';

const DEFAULT_COPY: Record<DisclosureKind, { title: string; body: string }> = {
  partnership: {
    title: 'Partnership disclosure',
    body:
      'This university is a Modex partner. Partnership means we have a contract to handle applications; it does not affect admission decisions, and it does not change what you pay the university.',
  },
  paid_placement: {
    title: 'Paid placement',
    body: 'This result is a paid placement. It is shown here because the institution paid for the position, not because it matched your profile better.',
  },
  commission: {
    title: 'How Modex is paid',
    body: 'Modex receives a fee from this university when a student enrols. The fee does not come out of your tuition and does not change your application outcome.',
  },
  ranking_method: {
    title: 'How this list is ordered',
    body: 'Results are ordered by how well your profile matches the published requirements. Commercial relationships do not move a programme up this list.',
  },
  guide_compensation: {
    title: 'How this guide is paid',
    body: 'Student guides are compensated by Modex, never by you and never per application. A guide cannot collect application fees or tuition.',
  },
};

export interface DisclosureNoticeProps {
  kind: DisclosureKind;
  /** Overrides the default copy where a market or contract needs different wording. */
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function DisclosureNotice({ kind, title, children, className }: DisclosureNoticeProps) {
  const copy = DEFAULT_COPY[kind];
  return (
    <aside className={cn('mx-disclosure', className)} aria-label={title ?? copy.title}>
      <InfoIcon size={14} />
      <div>
        <span className="mx-disclosure__title">{title ?? copy.title}</span>{' '}
        <span>{children ?? copy.body}</span>
      </div>
    </aside>
  );
}

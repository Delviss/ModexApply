import type { ScanState } from '@modex/contracts';
import { Badge, type BadgeTone } from '../primitives/badge.js';
import { CheckIcon, ClockIcon, HelpCircleIcon, XCircleIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<ScanStatePill>` — where a document is in the malware scan.
 *
 * Four states, each with an icon and a text label, because a student whose
 * passport is blocked needs to know that in greyscale, under deuteranopia and
 * through a screen reader — not only in red.
 *
 * `quarantined` is deliberately terminal in the copy. There is no path back to
 * `clean` for the same bytes, so the pill says "blocked" and the reason says to
 * upload a clean copy, rather than implying a retry on this file might work.
 */
const PRESENTATION: Record<
  ScanState,
  { tone: BadgeTone; label: string; Icon: typeof CheckIcon; spinning: boolean }
> = {
  pending: { tone: 'neutral', label: 'Checking for malware', Icon: ClockIcon, spinning: true },
  clean: { tone: 'success', label: 'Checked', Icon: CheckIcon, spinning: false },
  quarantined: { tone: 'danger', label: 'Blocked', Icon: XCircleIcon, spinning: false },
  failed: { tone: 'warning', label: 'Check did not finish', Icon: HelpCircleIcon, spinning: false },
};

export interface ScanStatePillProps {
  state: ScanState;
  /** The scanner's explanation, shown beneath. */
  detail?: string | null;
  className?: string;
}

export function ScanStatePill({ state, detail, className }: ScanStatePillProps) {
  const { tone, label, Icon, spinning } = PRESENTATION[state];

  return (
    <span className={cn('mx-scan', className)} data-state={state}>
      <Badge tone={tone} icon={<Icon size={12} />}>
        {label}
      </Badge>
      {spinning ? <span className="mx-scan__spinner" aria-hidden="true" /> : null}
      {detail == null || detail.length === 0 ? null : (
        <span className="mx-scan__detail">{detail}</span>
      )}
    </span>
  );
}

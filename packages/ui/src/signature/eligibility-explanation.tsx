import type {
  CheckOutcome,
  EligibilityCheck,
  EligibilityExplanation as Explanation,
  EligibilityVerdict,
} from '@modex/contracts';
import { Badge, type BadgeTone } from '../primitives/badge.js';
import { CheckIcon, HelpCircleIcon, SlashIcon, XCircleIcon } from '../primitives/icons.js';
import { formatDate } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * `<EligibilityExplanation>` — renders the engine's explanation object as
 * pass / fail / unknown / missing-data rows, each with its source (Phase 0 §2.9).
 *
 * It never collapses to a boolean. That is the whole point: a student told
 * "not eligible" with no reason cannot contest a wrong requirement, and
 * requirements *are* sometimes wrong. Every row shows what was required, what
 * the profile said, where the requirement came from, and — for missing data —
 * what to do about it.
 *
 * Built on the Task Steps state model, with the vendor block's colours rebound
 * to `--mx-success` / `--mx-action` / `--mx-ink-500` / `--mx-danger`.
 */

const OUTCOME_PRESENTATION: Record<
  CheckOutcome,
  { tone: BadgeTone; label: string; Icon: typeof CheckIcon }
> = {
  pass: { tone: 'success', label: 'Met', Icon: CheckIcon },
  fail: { tone: 'danger', label: 'Not met', Icon: XCircleIcon },
  missing_data: { tone: 'warning', label: 'We need more from you', Icon: HelpCircleIcon },
  unknown: { tone: 'neutral', label: 'Cannot assess', Icon: SlashIcon },
};

const VERDICT_PRESENTATION: Record<
  EligibilityVerdict,
  { tone: BadgeTone; label: string; explanation: string }
> = {
  eligible: {
    tone: 'success',
    label: 'You meet the published requirements',
    explanation:
      'Every requirement we could check is met. The university makes the final admission decision.',
  },
  not_eligible: {
    tone: 'danger',
    label: 'You do not meet a published requirement',
    explanation:
      'At least one requirement is not met. If you think a requirement is out of date, tell us — we will ask the university.',
  },
  incomplete: {
    tone: 'warning',
    label: 'We cannot finish this check yet',
    explanation:
      'Nothing here says you are ineligible. Some requirements need information you have not added yet.',
  },
  not_assessable: {
    tone: 'neutral',
    label: 'This programme cannot be checked automatically',
    explanation:
      'The published requirements are not in a form we can evaluate. Ask a student guide or the university directly.',
  },
};

export interface EligibilityExplanationProps {
  explanation: Explanation;
  className?: string;
}

export function EligibilityExplanation({ explanation, className }: EligibilityExplanationProps) {
  const verdict = VERDICT_PRESENTATION[explanation.verdict];

  return (
    <section className={cn('mx-eligibility', className)} aria-label="Eligibility explanation">
      <div className="mx-eligibility__verdict">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
      </div>
      <p className="mx-eligibility__reason">{verdict.explanation}</p>

      <ul className="mx-eligibility__list">
        {explanation.checks.map((check) => (
          <EligibilityRow key={check.requirementId} check={check} />
        ))}
      </ul>

      <p className="mx-eligibility__meta">
        Checked {formatDate(explanation.evaluatedAt)}
        {explanation.catalogueVersion !== null
          ? ` against catalogue version ${explanation.catalogueVersion}`
          : ''}
        . Modex does not make admission decisions.
      </p>
    </section>
  );
}

function EligibilityRow({ check }: { check: EligibilityCheck }) {
  const { tone, label, Icon } = OUTCOME_PRESENTATION[check.outcome];
  return (
    <li className="mx-eligibility__row" data-outcome={check.outcome}>
      <span className="mx-eligibility__icon">
        <Icon size={16} />
      </span>
      <div>
        <p className="mx-eligibility__requirement">{check.requirement}</p>
        <p className="mx-eligibility__reason">
          <Badge tone={tone}>{label}</Badge> {check.reason}
        </p>
        {check.studentValue !== null ? (
          <p className="mx-eligibility__meta">Your profile says: {check.studentValue}</p>
        ) : null}
        {check.remedy !== null ? <p className="mx-eligibility__remedy">{check.remedy}</p> : null}
        {check.sourceRef !== null ? (
          <p className="mx-eligibility__meta">Source: {check.sourceRef}</p>
        ) : null}
      </div>
    </li>
  );
}

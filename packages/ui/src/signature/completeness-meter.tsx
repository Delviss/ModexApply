import type { ProfileCompleteness } from '@modex/contracts';
import { cn } from '../lib/cn.js';

/**
 * `<CompletenessMeter>` — how much of the profile is filled in.
 *
 * **This is not an admission likelihood, and the component is built so it
 * cannot become one.** It takes a `ProfileCompleteness`, whose type has no
 * score, probability or chance field to bind to; it is labelled "Profile
 * completeness"; and it renders the count as "6 of 10 sections", not as a bare
 * percentage that reads like a prediction.
 *
 * The rule from the issue is that it must never be framed, labelled or visually
 * implied as an admission likelihood. That is a hard product boundary, so the
 * component also carries the sentence saying what it is — a caller cannot drop
 * this next to offer language and have it read as a chance of getting in.
 */
export interface CompletenessMeterProps {
  completeness: ProfileCompleteness;
  /** Renders the outstanding items as links. Omitted on compact surfaces. */
  renderGap?: (gap: ProfileCompleteness['missing'][number]) => React.ReactNode;
  className?: string;
}

export function CompletenessMeter({
  completeness,
  renderGap,
  className,
}: CompletenessMeterProps) {
  const { completed, total, missing } = completeness;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <section className={cn('mx-completeness', className)} aria-label="Profile completeness">
      <div className="mx-completeness__head">
        <p className="mx-completeness__label">Profile completeness</p>
        <p className="mx-completeness__count">
          {completed} of {total} sections
        </p>
      </div>

      <div
        className="mx-completeness__track"
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Profile completeness"
        aria-valuetext={`${completed} of ${total} sections complete`}
      >
        <div className="mx-completeness__bar" style={{ width: `${percent}%` }} />
      </div>

      <p className="mx-completeness__note">
        This shows how much of your profile you have filled in. It is not a
        prediction about whether a university will admit you — only the
        university decides that.
      </p>

      {missing.length === 0 ? (
        <p className="mx-completeness__done">Your profile is complete.</p>
      ) : (
        <ul className="mx-completeness__gaps">
          {missing.map((gap) => (
            <li key={gap.field}>
              {renderGap === undefined ? gap.label : renderGap(gap)}
              <span className="mx-completeness__unlocks"> — {gap.unlocks}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

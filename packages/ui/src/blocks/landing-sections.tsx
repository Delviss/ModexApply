import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * The rest of the landing page: the section frame, the audience cards, the
 * numbered journey, the destination tile that rides the marquee, and the
 * closing call to action.
 *
 * These follow the marketplace shape a study-abroad homepage is expected to
 * have — three audiences, a how-it-works, destinations, a closing band — with
 * the claims rewritten to ones this platform can actually stand behind. The
 * shape is conventional on purpose: a student comparing us with the incumbent
 * should not have to learn a new page to do it.
 */

export interface LandingSectionProps {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** `tinted` is the brand-50 ground; `canvas` separates two white sections. */
  tone?: 'surface' | 'canvas' | 'tinted';
  /** Sits under the heading block, before the children — a disclosure, a note. */
  lead?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
  className?: string;
}

export function LandingSection({
  id,
  eyebrow,
  title,
  description,
  tone = 'surface',
  lead,
  children,
  footnote,
  className,
}: LandingSectionProps) {
  return (
    <section id={id} className={cn('mx-landing-section', className)} data-tone={tone}>
      <div className="mx-landing-section__inner">
        <div className="mx-landing-section__head">
          {eyebrow ? <span className="mx-landing-eyebrow">{eyebrow}</span> : null}
          <h2 className="mx-landing-section__title">{title}</h2>
          {description ? <p className="mx-landing-section__description">{description}</p> : null}
        </div>
        {lead}
        {children}
        {footnote ? <p className="mx-landing-section__footnote">{footnote}</p> : null}
      </div>
    </section>
  );
}

export interface AudienceCardProps {
  /** Who this column is for — students, universities, student guides. */
  audience: string;
  title: ReactNode;
  description: ReactNode;
  /** What this audience gets, in plain sentences. Two or three, not ten. */
  points?: ReactNode[];
  action: { label: string; href: string };
  className?: string;
}

export function AudienceCard({
  audience,
  title,
  description,
  points = [],
  action,
  className,
}: AudienceCardProps) {
  return (
    <article className={cn('mx-audience-card', className)}>
      <span className="mx-landing-eyebrow">{audience}</span>
      <h3 className="mx-audience-card__title">{title}</h3>
      <p className="mx-audience-card__description">{description}</p>
      {points.length > 0 ? (
        <ul className="mx-audience-card__points">
          {points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      ) : null}
      <a className="mx-audience-card__action" href={action.href}>
        {action.label}
        <span aria-hidden="true"> →</span>
      </a>
    </article>
  );
}

export interface JourneyStep {
  title: ReactNode;
  body: ReactNode;
  /** Who owns this step. Naming it is the whole argument against the agent model. */
  owner?: string;
}

export function JourneySteps({ steps, className }: { steps: JourneyStep[]; className?: string }) {
  return (
    <ol className={cn('mx-journey', className)}>
      {steps.map((step, index) => (
        <li className="mx-journey__step" key={index}>
          <span className="mx-journey__index" aria-hidden="true">
            {index + 1}
          </span>
          <div className="mx-journey__text">
            <h3 className="mx-journey__title">{step.title}</h3>
            {step.owner ? (
              <span className="mx-journey__owner">{step.owner}</span>
            ) : null}
            <p className="mx-journey__body">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface DestinationCardProps {
  /** ISO 3166-1 alpha-2. Shown as a chip rather than a flag: a flag is an image
   *  with politics attached, and a code is what the catalogue filters on. */
  code: string;
  name: string;
  /** One line of fact, with its source implied by where it came from. */
  detail?: ReactNode;
  meta?: ReactNode;
  href: string;
  className?: string;
}

export function DestinationCard({ code, name, detail, meta, href, className }: DestinationCardProps) {
  return (
    <a className={cn('mx-destination', className)} href={href}>
      <span className="mx-destination__code" aria-hidden="true">
        {code}
      </span>
      <span className="mx-destination__name">{name}</span>
      {detail ? <span className="mx-destination__detail">{detail}</span> : null}
      {meta ? <span className="mx-destination__meta">{meta}</span> : null}
    </a>
  );
}

export interface CtaBandProps {
  title: ReactNode;
  description?: ReactNode;
  primaryAction: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  footnote?: ReactNode;
  className?: string;
}

/**
 * The closing band. Brand crimson is the ground here rather than an accent,
 * which is the one place the palette rule bends — and it earns it by carrying
 * exactly one action and no state. Nothing on this band means "approved",
 * "eligible" or "verified".
 */
export function CtaBand({
  title,
  description,
  primaryAction,
  secondaryAction,
  footnote,
  className,
}: CtaBandProps) {
  return (
    <section className={cn('mx-cta-band', className)}>
      <div className="mx-cta-band__inner">
        <h2 className="mx-cta-band__title">{title}</h2>
        {description ? <p className="mx-cta-band__description">{description}</p> : null}
        <div className="mx-cta-band__actions">
          <a className="mx-button mx-cta-band__primary" data-size="lg" href={primaryAction.href}>
            {primaryAction.label}
          </a>
          {secondaryAction ? (
            <a className="mx-cta-band__link" href={secondaryAction.href}>
              {secondaryAction.label}
            </a>
          ) : null}
        </div>
        {footnote ? <p className="mx-cta-band__footnote">{footnote}</p> : null}
      </div>
    </section>
  );
}

export interface ProofPointProps {
  value: ReactNode;
  label: ReactNode;
  /** Where the number comes from. A count with no source is the thing this
   *  platform exists to remove, so the source renders next to the number. */
  source?: ReactNode;
  tone?: 'neutral' | 'brand';
}

/** A counted fact in the hero's proof row, or in the stats band. */
export function ProofPoint({ value, label, source, tone = 'neutral' }: ProofPointProps) {
  return (
    <div className="mx-proof-point" data-tone={tone}>
      <span className="mx-proof-point__value">{value}</span>
      <span className="mx-proof-point__label">{label}</span>
      {source ? <span className="mx-proof-point__source">{source}</span> : null}
    </div>
  );
}

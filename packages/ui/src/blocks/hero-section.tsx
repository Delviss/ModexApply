import type { ReactNode } from 'react';
import { Button } from '../primitives/button.js';
import { usePrefersReducedMotion } from '../lib/motion.js';
import { cn } from '../lib/cn.js';

/**
 * Hero — re-themed from
 * `@uniquesonu/hero-section-enterprise-ready-landing-page-hero-with-dual-ctas`.
 *
 * The vendor block animates its entrance with Framer Motion. Per the re-theming
 * note on issue #3 that animation is gated on `prefers-reduced-motion`; here it
 * degrades to a static render rather than a shortened one.
 *
 * The two CTAs are the product's positioning made literal: "Browse programmes"
 * (apply direct) and "Talk to a student" (ask students).
 */

export interface HeroAction {
  label: string;
  href: string;
}

export interface HeroSectionProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  primaryAction: HeroAction;
  secondaryAction?: HeroAction;
  /** Verification badge, provenance stamp or stat row sits here. */
  aside?: ReactNode;
  footnote?: ReactNode;
  className?: string;
}

export function HeroSection({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  aside,
  footnote,
  className,
}: HeroSectionProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <section
      className={cn('mx-hero', className)}
      style={{
        display: 'grid',
        gap: 'var(--mx-space-8)',
        padding: 'var(--mx-space-12) var(--mx-space-6)',
        animation: reducedMotion ? 'none' : `mx-hero-in var(--mx-motion-surface) var(--mx-motion-easing)`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)', maxWidth: '62ch' }}>
        {eyebrow ? <div>{eyebrow}</div> : null}
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--mx-text-3xl)',
            lineHeight: 'var(--mx-leading-tight)',
            color: 'var(--mx-ink-900)',
          }}
        >
          {title}
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--mx-text-md)', color: 'var(--mx-ink-600)' }}>
          {description}
        </p>
        <div style={{ display: 'flex', gap: 'var(--mx-space-3)', flexWrap: 'wrap' }}>
          <a className="mx-button" data-variant="primary" data-size="lg" href={primaryAction.href}>
            {primaryAction.label}
          </a>
          {secondaryAction ? (
            <a
              className="mx-button"
              data-variant="secondary"
              data-size="lg"
              href={secondaryAction.href}
            >
              {secondaryAction.label}
            </a>
          ) : null}
        </div>
        {footnote ? (
          <p style={{ margin: 0, fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)' }}>
            {footnote}
          </p>
        ) : null}
      </div>
      {aside}
    </section>
  );
}

/** Re-exported so consuming apps can render a hero CTA without the whole block. */
export { Button as HeroButton };

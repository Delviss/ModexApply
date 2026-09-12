'use client';

import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../lib/motion.js';
import { cn } from '../lib/cn.js';

/**
 * LandingHero — the public front door.
 *
 * Re-themed from the `pulse-fit-hero.tsx` block supplied for this brief, laid
 * out against the study-abroad marketplace pattern ApplyBoard uses: a slim
 * header, one centred promise, the search that is the actual first step, and a
 * full-bleed rail of destinations under the fold line.
 *
 * What the vendor block carried that did not survive the re-theme:
 *
 * - **Its palette.** The original is built from inline literals — a near-black
 *   ink, a pale blue gradient, hand-mixed translucent shadows. Every one of
 *   them is a Red Velvet token here, and the vendor-colour CI gate is what
 *   proves the re-theme was finished rather than half-done.
 * - **Framer Motion.** The entrance is CSS, gated on `prefers-reduced-motion`
 *   in both the token layer and `usePrefersReducedMotion`, per Phase 0 §1.6.
 * - **The avatar social-proof row.** Four stock faces and "join over 10,000+
 *   people" is exactly the unsourced claim this platform exists to remove, so
 *   `proof` takes counted facts instead — and the counts come from the
 *   register, not from marketing.
 * - **The dropdown nav item.** A chevron that opens nothing tests worse than no
 *   chevron; the nav here is flat links to surfaces that exist.
 *
 * The disclaimer is not decoration and not optional in practice: it is where
 * the page says, above the fold, that Modex does not decide admissions.
 */

export interface LandingNavItem {
  label: string;
  href: string;
  /** Marks the current section for `aria-current`. */
  current?: boolean;
}

export interface LandingAction {
  label: string;
  href: string;
}

export interface LandingHeroProps {
  brand: { label: string; href: string; mark?: ReactNode };
  navigation?: LandingNavItem[];
  /** The header's own action — sign in, or the partner route. */
  navAction?: LandingAction;
  navSecondary?: LandingAction;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  /** The lead control. On this platform that is programme search. */
  search?: ReactNode;
  primaryAction?: LandingAction;
  secondaryAction?: LandingAction;
  /** The line that says what Modex does not do. Rendered, never collapsed. */
  disclaimer?: ReactNode;
  /** Counted facts under the fold — never avatars, never an unsourced total. */
  proof?: ReactNode;
  /** Full-bleed content below the hero body, typically the destination rail. */
  children?: ReactNode;
  className?: string;
}

export function LandingHero({
  brand,
  navigation = [],
  navAction,
  navSecondary,
  eyebrow,
  title,
  subtitle,
  search,
  primaryAction,
  secondaryAction,
  disclaimer,
  proof,
  children,
  className,
}: LandingHeroProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className={cn('mx-landing-hero', className)} data-animate={!reducedMotion}>
      <header className="mx-landing-header">
        <a className="mx-landing-brand" href={brand.href}>
          {brand.mark ? <span className="mx-landing-brand__mark">{brand.mark}</span> : null}
          {brand.label}
        </a>
        {navigation.length > 0 ? (
          <nav className="mx-landing-nav" aria-label="Main">
            {navigation.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="mx-landing-nav__link"
                aria-current={item.current ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="mx-landing-header__actions">
          {navSecondary ? (
            <a className="mx-landing-nav__link" href={navSecondary.href}>
              {navSecondary.label}
            </a>
          ) : null}
          {navAction ? (
            <a className="mx-button" data-variant="primary" data-size="md" href={navAction.href}>
              {navAction.label}
            </a>
          ) : null}
        </div>
      </header>

      <div className="mx-landing-hero__body">
        {eyebrow ? <div className="mx-landing-hero__eyebrow">{eyebrow}</div> : null}
        <h1 className="mx-landing-hero__title">{title}</h1>
        <p className="mx-landing-hero__subtitle">{subtitle}</p>
        {search ? <div className="mx-landing-hero__search">{search}</div> : null}
        {primaryAction || secondaryAction ? (
          <div className="mx-landing-hero__actions">
            {primaryAction ? (
              <a className="mx-button" data-variant="primary" data-size="lg" href={primaryAction.href}>
                {primaryAction.label}
              </a>
            ) : null}
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
        ) : null}
        {disclaimer ? <p className="mx-landing-hero__disclaimer">{disclaimer}</p> : null}
        {proof ? <div className="mx-landing-hero__proof">{proof}</div> : null}
      </div>

      {children}
    </div>
  );
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LandingHero } from '../src/blocks/landing-hero.js';
import { Marquee } from '../src/blocks/marquee.js';
import {
  AudienceCard,
  CtaBand,
  DestinationCard,
  JourneySteps,
  LandingSection,
  ProofPoint,
} from '../src/blocks/landing-sections.js';

/** Forces `usePrefersReducedMotion` to report a reduced-motion preference. */
function withReducedMotion() {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LandingHero', () => {
  const base = {
    brand: { label: 'Modex Apply', href: '/', mark: 'M' },
    title: 'Apply directly.',
    subtitle: 'No agent in the middle.',
  };

  it('renders one h1 and names the nav for assistive technology', () => {
    render(
      <LandingHero
        {...base}
        navigation={[
          { label: 'Programmes', href: '/programmes' },
          { label: 'Student guides', href: '/guides', current: true },
        ]}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Student guides' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  /**
   * The disclaimer is the sentence that says Modex does not decide admissions.
   * It renders above the fold or the page is making a promise it cannot keep,
   * so it is asserted rather than left to a designer's discretion.
   */
  it('renders the disclaimer it is given', () => {
    render(<LandingHero {...base} disclaimer="Modex does not make admission decisions." />);
    expect(screen.getByText('Modex does not make admission decisions.')).toBeInTheDocument();
  });

  it('drops the entrance animation under prefers-reduced-motion', () => {
    const restore = withReducedMotion();
    const { container } = render(<LandingHero {...base} />);
    expect(container.querySelector('.mx-landing-hero')).toHaveAttribute('data-animate', 'false');
    restore();
  });
});

describe('Marquee', () => {
  const items = [
    <DestinationCard key="GB" code="GB" name="United Kingdom" href="/programmes?country=GB" />,
    <DestinationCard key="IE" code="IE" name="Ireland" href="/programmes?country=IE" />,
  ];

  it('hides the duplicated set from assistive technology', () => {
    render(<Marquee items={items} label="Study destinations" />);

    // Two copies are painted so the loop is seamless; one is read.
    expect(screen.getAllByRole('link', { name: /United Kingdom/ })).toHaveLength(1);
    const region = screen.getByRole('region', { name: 'Study destinations' });
    expect(region.querySelectorAll('.mx-marquee__track')).toHaveLength(2);
    expect(region.querySelectorAll('[aria-hidden="true"].mx-marquee__track')).toHaveLength(1);
  });

  /**
   * WCAG 2.2.2: content that moves for more than five seconds needs a pause
   * control. Pausing drops to the still, scrollable row rather than freezing a
   * transform mid-flight, so every card stays reachable once it stops.
   */
  it('pauses into a single scrollable row', () => {
    const { container } = render(<Marquee items={items} label="Study destinations" />);
    const toggle = screen.getByRole('button', { name: /pause/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: /resume/i })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.mx-marquee')).toHaveAttribute('data-still', 'true');
    expect(container.querySelectorAll('.mx-marquee__track')).toHaveLength(1);
    expect(container.querySelector('.mx-marquee__viewport')).toHaveAttribute('tabindex', '0');
  });

  it('never starts moving under prefers-reduced-motion, and offers no control to start it', () => {
    const restore = withReducedMotion();
    const { container } = render(<Marquee items={items} label="Study destinations" />);

    expect(container.querySelector('.mx-marquee')).toHaveAttribute('data-still', 'true');
    expect(container.querySelectorAll('.mx-marquee__track')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    restore();
  });

  /**
   * The echo is decoration for the loop, so it is hidden from assistive
   * technology — and anything hidden from assistive technology must also be out
   * of the tab order, or a keyboard user lands on an element that, as far as a
   * screen reader is concerned, does not exist. `tabindex="-1"` rather than
   * `inert`, so the duplicated cards stay clickable.
   */
  it('takes the echoed cards out of the tab order but leaves them clickable', () => {
    const { container } = render(<Marquee items={items} label="Study destinations" />);
    const echo = container.querySelector('[aria-hidden="true"].mx-marquee__track');
    const links = [...(echo?.querySelectorAll('a') ?? [])];

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.tabIndex).toBe(-1);
      expect(link).not.toHaveAttribute('inert');
    }
  });

  it('renders nothing rather than an empty rail', () => {
    const { container } = render(<Marquee items={[]} label="Study destinations" />);
    expect(container.querySelector('.mx-marquee')).toBeNull();
  });
});

describe('the landing sections', () => {
  it('gives every section a level-2 heading and an addressable id', () => {
    render(
      <LandingSection id="how-it-works" eyebrow="How it works" title="Four steps">
        <p>Body</p>
      </LandingSection>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Four steps' });
    expect(heading.closest('section')).toHaveAttribute('id', 'how-it-works');
  });

  it('names the owner of every journey step', () => {
    render(
      <JourneySteps
        steps={[
          { title: 'Search', owner: 'The platform', body: 'Explainable matching.' },
          { title: 'Apply', owner: 'You', body: 'An immutable snapshot.' },
        ]}
      />,
    );
    // The list is ordered: step two after step one is the product's argument.
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('carries the source line on a proof point', () => {
    render(
      <ProofPoint
        value="0"
        label="Guides who can take a payment from you"
        source="A payment request opens a trust case."
      />,
    );
    expect(screen.getByText('A payment request opens a trust case.')).toBeInTheDocument();
  });

  it('renders an audience card as an article with one action', () => {
    render(
      <AudienceCard
        audience="Students"
        title="Apply direct"
        description="Keep what you build."
        points={['Your documents stay yours']}
        action={{ label: 'Browse programmes', href: '/programmes' }}
      />,
    );
    expect(screen.getByRole('link', { name: /Browse programmes/ })).toHaveAttribute(
      'href',
      '/programmes',
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Your documents stay yours');
  });

  it('keeps the closing band to one primary action and no state', () => {
    render(
      <CtaBand
        title="Start with a programme"
        primaryAction={{ label: 'Browse programmes', href: '/programmes' }}
        secondaryAction={{ label: 'Read questions', href: '/questions' }}
        footnote="Free to search."
      />,
    );
    const band = screen.getByRole('heading', { level: 2 }).closest('section');
    expect(band?.querySelectorAll('.mx-button')).toHaveLength(1);
    expect(screen.getByText('Free to search.')).toBeInTheDocument();
  });
});

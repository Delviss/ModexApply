import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { computePriceBreakdown, money, type PriceableOffer } from '@modex/contracts';
import { OfferCard, type OfferCardProps } from '../src/signature/offer-card.js';
import { PriceBreakdown } from '../src/signature/price-breakdown.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function card(overrides: Partial<OfferCardProps> = {}): OfferCardProps {
  return {
    offerId: 'offer_1',
    name: 'Merit award',
    type: 'tuition_discount',
    value: { kind: 'percentage', basisPoints: 1000 },
    duration: 'first_year',
    savingLabel: '£1,425.00',
    validUntil: '2026-09-01T00:00:00.000Z',
    claimDeadline: null,
    termsSummary: 'Applies to the first year of tuition only.',
    exclusions: [],
    sourceRef: 'https://example.edu/scholarships',
    verifiedBy: 'A. Okafor, Modex Trust',
    verifiedAt: '2026-05-01T00:00:00.000Z',
    lastCheckedAt: '2026-05-20T00:00:00.000Z',
    verificationState: 'verified',
    eligible: true,
    now: NOW,
    ...overrides,
  };
}

function priceable(overrides: Partial<PriceableOffer> = {}): PriceableOffer {
  return {
    offerId: 'offer_1',
    offerKey: 'merit-award',
    version: 3,
    name: 'Merit award',
    type: 'tuition_discount',
    value: { kind: 'percentage', basisPoints: 1000 },
    appliesTo: 'tuition',
    duration: 'first_year',
    exclusions: [],
    sourceRef: 'https://example.edu/scholarships',
    programKey: 'msc-data-science',
    validUntil: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('<OfferCard>', () => {
  it('refuses to render an offer with no verifier', () => {
    const { container } = render(<OfferCard {...card({ verifiedBy: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('refuses to render an offer with no last-checked date', () => {
    const { container } = render(<OfferCard {...card({ lastCheckedAt: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries a verification badge and a provenance stamp', () => {
    render(<OfferCard {...card()} />);
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0);
    expect(screen.getByText('Source updated')).toBeInTheDocument();
    // Named on both: the badge says who stands behind the claim, the stamp says
    // who reviewed the record. Same person here, two different assertions.
    expect(screen.getAllByText(/A\. Okafor, Modex Trust/).length).toBe(2);
  });

  it('shows an ineligible offer with its specific unmet condition, not hidden', () => {
    render(
      <OfferCard
        {...card({
          eligible: false,
          savingLabel: null,
          unmetCondition: 'This award is for nationals of Nigeria, Ghana and Kenya.',
          remedy: 'Add your nationality to your profile.',
        })}
      />,
    );

    expect(screen.getByText('Merit award')).toBeInTheDocument();
    expect(screen.getByText(/nationals of Nigeria, Ghana and Kenya/)).toBeInTheDocument();
    expect(screen.getByText(/Add your nationality/)).toBeInTheDocument();
    // Never styled as available.
    expect(document.querySelector('.mx-offer')).toHaveAttribute('data-eligible', 'false');
  });

  it('puts exclusions on the card rather than behind a terms link', () => {
    render(
      <OfferCard
        {...card({
          exclusions: [
            {
              kind: 'not_combinable_with_type',
              otherOfferKey: null,
              otherOfferType: 'scholarship',
              programKeys: [],
              humanSummary: 'Not combinable with any scholarship from this university.',
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByText('Not combinable with any scholarship from this university.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/terms apply/i)).not.toBeInTheDocument();
  });

  it('says which offer was applied instead when this one was suppressed', () => {
    render(
      <OfferCard
        {...card({
          suppressedReason:
            'Not combinable with the country award. We applied Country award instead, because it saves you more.',
        })}
      />,
    );
    expect(screen.getByText(/We applied Country award instead/)).toBeInTheDocument();
  });

  it('shows a date rather than a ticking clock, and escalates at 14 and 3 days', () => {
    const at = (days: number) =>
      new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

    const { rerender } = render(<OfferCard {...card({ validUntil: at(40) })} />);
    expect(document.querySelector('.mx-offer__deadline')).toHaveAttribute('data-urgency', 'none');

    rerender(<OfferCard {...card({ validUntil: at(10) })} />);
    expect(document.querySelector('.mx-offer__deadline')).toHaveAttribute('data-urgency', 'due');
    expect(screen.getByText(/10 days left/)).toBeInTheDocument();

    rerender(<OfferCard {...card({ validUntil: at(2) })} />);
    expect(document.querySelector('.mx-offer__deadline')).toHaveAttribute('data-urgency', 'urgent');
    expect(screen.getByText(/2 days left/)).toBeInTheDocument();

    rerender(<OfferCard {...card({ validUntil: at(-1) })} />);
    expect(screen.getByText(/This offer closed on/)).toBeInTheDocument();
  });

  it('names the benefit and its provider rather than pricing it', () => {
    render(
      <OfferCard
        {...card({
          type: 'student_benefit',
          value: { kind: 'benefit_in_kind', benefit: 'Guaranteed housing', provider: 'Campus Services' },
          savingLabel: null,
          redemptionMethod: 'Ask for the Modex code at your offer interview.',
        })}
      />,
    );
    expect(screen.getByText('Guaranteed housing (provided by Campus Services)')).toBeInTheDocument();
    expect(screen.getByText(/Ask for the Modex code/)).toBeInTheDocument();
  });
});

describe('<PriceBreakdown>', () => {
  const breakdown = computePriceBreakdown({
    tuition: money(1_425_000, 'GBP'),
    applicationFee: money(5_000, 'GBP'),
    deposit: null,
    eligible: [priceable()],
    ineligible: [],
    now: NOW,
  });

  it('lists tuition, then the offer, then the net price', () => {
    render(<PriceBreakdown breakdown={breakdown} />);
    expect(screen.getByText('Tuition (first year)')).toBeInTheDocument();
    expect(screen.getByText('Application fee')).toBeInTheDocument();
    // £14,250 tuition + £50 application fee, less 10% of tuition.
    expect(screen.getByText('£12,875.00')).toBeInTheDocument();
  });

  it('traces each saving line to its offer version and source', () => {
    render(<PriceBreakdown breakdown={breakdown} />);
    expect(screen.getByText(/version 3/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'source' })).toHaveAttribute(
      'href',
      'https://example.edu/scholarships',
    );
  });

  it('never communicates the saving by colour alone', () => {
    render(<PriceBreakdown breakdown={breakdown} />);
    // The word and the minus sign are in the text, not only in --mx-success.
    expect(screen.getByText(/saving of £1,425\.00/)).toBeInTheDocument();
    expect(screen.getByText(/You save/)).toBeInTheDocument();
  });

  it('says plainly when nothing applies rather than inventing a discount', () => {
    render(
      <PriceBreakdown
        breakdown={computePriceBreakdown({
          tuition: money(1_425_000, 'GBP'),
          applicationFee: null,
          deposit: null,
          eligible: [],
          ineligible: [],
          now: NOW,
        })}
      />,
    );
    expect(screen.getByText(/No offer you currently qualify for reduces it/)).toBeInTheDocument();
    expect(screen.queryByText(/You save/)).not.toBeInTheDocument();
  });

  it('states which offer was applied when two cannot combine', () => {
    const withConflict = computePriceBreakdown({
      tuition: money(1_000_000, 'GBP'),
      applicationFee: null,
      deposit: null,
      eligible: [
        priceable({
          offerId: 'a',
          offerKey: 'merit',
          name: 'Merit award',
          value: { kind: 'percentage', basisPoints: 2000 },
        }),
        priceable({
          offerId: 'b',
          offerKey: 'country',
          name: 'Country award',
          value: { kind: 'percentage', basisPoints: 1000 },
          exclusions: [
            {
              kind: 'not_combinable_with_offer',
              otherOfferKey: 'merit',
              otherOfferType: null,
              programKeys: [],
              humanSummary: 'Not combinable with the merit award.',
            },
          ],
        }),
      ],
      ineligible: [],
      now: NOW,
    });

    render(<PriceBreakdown breakdown={withConflict} />);
    expect(screen.getByText('Offers that could not be combined')).toBeInTheDocument();
    expect(screen.getByText(/We applied Merit award instead/)).toBeInTheDocument();
  });
});

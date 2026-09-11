import { describe, expect, it } from 'vitest';
import {
  OFFER_EXPIRY_URGENT_DAYS,
  OFFER_EXPIRY_WARNING_DAYS,
  OfferValueSchema,
  canPublishOffer,
  canTransitionAttachment,
  computePriceBreakdown,
  daysUntilOfferExpiry,
  formatBasisPoints,
  formatOfferValue,
  isOfferLive,
  isRenderableOffer,
  money,
  offerExpiryUrgency,
  offerPublicationBlockers,
  offersConflict,
  resolveStacking,
  savingFor,
  savingsSecured,
  type Offer,
  type OfferExclusion,
  type PriceableOffer,
  type StackingCandidate,
} from '../src/index.js';

const NOW = new Date('2026-03-01T00:00:00.000Z');

function exclusion(overrides: Partial<OfferExclusion> = {}): OfferExclusion {
  return {
    kind: 'not_combinable_with_offer',
    otherOfferKey: null,
    otherOfferType: null,
    programKeys: [],
    humanSummary: 'Not combinable with any other award from this university.',
    ...overrides,
  };
}

function publishable(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    offerKey: 'merit-award',
    version: 1,
    institutionId: 'inst-1',
    programKey: 'msc-data-science',
    type: 'tuition_discount',
    name: 'Merit award',
    value: { kind: 'percentage', basisPoints: 1000 },
    appliesTo: 'tuition',
    duration: 'first_year',
    conditions: [
      {
        id: 'cond-1',
        ruleType: 'gpa_minimum',
        ruleJson: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 3.5 },
        humanSummary: 'A grade point average of 3.5 or above on a 4.0 scale.',
        sourceRef: 'https://example.edu/scholarships',
      },
    ],
    exclusions: [],
    termsSummary: 'Applies to the first year of tuition only.',
    applicationMethod: null,
    redemptionMethod: null,
    claimDeadline: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-09-01T00:00:00.000Z',
    publicationState: 'published',
    verificationState: 'verified',
    verifiedBy: 'A. Okafor, Modex Trust',
    verifiedAt: '2026-02-01T00:00:00.000Z',
    lastCheckedAt: '2026-02-20T00:00:00.000Z',
    sourceRef: 'https://example.edu/scholarships',
    ...overrides,
  };
}

function priceable(overrides: Partial<PriceableOffer> = {}): PriceableOffer {
  return {
    offerId: 'offer-1',
    offerKey: 'merit-award',
    version: 1,
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

function candidate(overrides: Partial<StackingCandidate> = {}): StackingCandidate {
  return {
    offerKey: 'merit-award',
    offerId: 'offer-1',
    type: 'tuition_discount',
    name: 'Merit award',
    appliesTo: 'tuition',
    exclusions: [],
    saving: money(100_000, 'GBP'),
    exhaustsBase: false,
    programKey: 'msc-data-science',
    ...overrides,
  };
}

describe('offer value', () => {
  it('refuses a free-text value', () => {
    expect(OfferValueSchema.safeParse({ kind: 'percentage', basisPoints: '10%' }).success).toBe(false);
    expect(OfferValueSchema.safeParse({ kind: 'fixed_amount', amount: '£5,000' }).success).toBe(false);
    expect(
      OfferValueSchema.safeParse({ kind: 'fixed_amount', amount: { amountMinor: 500_000, currency: 'GBP' } })
        .success,
    ).toBe(true);
  });

  it('refuses a fractional or out-of-range percentage', () => {
    expect(OfferValueSchema.safeParse({ kind: 'percentage', basisPoints: 12.5 }).success).toBe(false);
    expect(OfferValueSchema.safeParse({ kind: 'percentage', basisPoints: 10_001 }).success).toBe(false);
    expect(OfferValueSchema.safeParse({ kind: 'percentage', basisPoints: 0 }).success).toBe(false);
  });

  it('formats basis points without touching a float', () => {
    expect(formatBasisPoints(1000)).toBe('10');
    expect(formatBasisPoints(1250)).toBe('12.5');
    expect(formatBasisPoints(1005)).toBe('10.05');
    expect(formatBasisPoints(10_000)).toBe('100');
  });

  it('names the provider of a benefit rather than pricing it', () => {
    expect(
      formatOfferValue({ kind: 'benefit_in_kind', benefit: 'Airport transfer', provider: 'Campus Services' }),
    ).toBe('Airport transfer (provided by Campus Services)');
  });
});

describe('publication gate', () => {
  it('passes a complete offer', () => {
    expect(canPublishOffer(publishable())).toEqual({ ok: true, blockers: [] });
  });

  it.each([
    ['source', { sourceRef: null }],
    ['conditions', { conditions: [] }],
    ['terms', { termsSummary: null }],
    ['a verifier', { verifiedBy: null }],
    ['a verification date', { verifiedAt: null }],
    ['a last-checked date', { lastCheckedAt: null }],
    ['a verified state', { verificationState: 'pending' as const }],
  ])('refuses an offer with no %s', (_label, patch) => {
    const result = canPublishOffer(publishable(patch));
    expect(result.ok).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it('requires a deadline and an application method for a scholarship', () => {
    const blockers = offerPublicationBlockers(
      publishable({ type: 'scholarship', claimDeadline: null, applicationMethod: null }),
    );
    expect(blockers.join(' ')).toMatch(/deadline/i);
    expect(blockers.join(' ')).toMatch(/application method/i);
  });

  it('requires a benefit and a redemption method for a student benefit', () => {
    const blockers = offerPublicationBlockers(
      publishable({ type: 'student_benefit', appliesTo: 'none', redemptionMethod: null }),
    );
    expect(blockers.join(' ')).toMatch(/redemption method/i);
    expect(blockers.join(' ')).toMatch(/named benefit and provider/i);
  });

  it('refuses a fee waiver pointed at tuition', () => {
    const blockers = offerPublicationBlockers(
      publishable({ type: 'application_fee_waiver', appliesTo: 'tuition' }),
    );
    expect(blockers.join(' ')).toMatch(/application fee waiver applies to the application fee/i);
  });

  it('refuses a validity window that ends before it starts', () => {
    const blockers = offerPublicationBlockers(
      publishable({ validFrom: '2026-09-01T00:00:00.000Z', validUntil: '2026-01-01T00:00:00.000Z' }),
    );
    expect(blockers.join(' ')).toMatch(/ends after it starts/i);
  });
});

describe('liveness and expiry', () => {
  it('is live inside the window and dead outside it', () => {
    expect(isOfferLive(publishable(), NOW)).toBe(true);
    expect(isOfferLive(publishable(), new Date('2026-10-01T00:00:00.000Z'))).toBe(false);
    expect(isOfferLive(publishable(), new Date('2025-10-01T00:00:00.000Z'))).toBe(false);
  });

  it('is not live while unpublished or unverified, whatever the dates say', () => {
    expect(isOfferLive(publishable({ publicationState: 'unpublished' }), NOW)).toBe(false);
    expect(isOfferLive(publishable({ verificationState: 'revoked' }), NOW)).toBe(false);
  });

  it('will not render without a verifier and a last-checked date', () => {
    expect(isRenderableOffer(publishable())).toBe(true);
    expect(isRenderableOffer(publishable({ verifiedBy: null }))).toBe(false);
    expect(isRenderableOffer(publishable({ lastCheckedAt: null }))).toBe(false);
  });

  it('warns at 14 days and escalates at 3', () => {
    const at = (days: number) =>
      new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    expect(offerExpiryUrgency(at(40), NOW)).toBe('none');
    expect(offerExpiryUrgency(at(OFFER_EXPIRY_WARNING_DAYS), NOW)).toBe('due');
    expect(offerExpiryUrgency(at(OFFER_EXPIRY_URGENT_DAYS), NOW)).toBe('urgent');
    expect(offerExpiryUrgency(at(-1), NOW)).toBe('lapsed');
    expect(offerExpiryUrgency(null, NOW)).toBe('none');
    expect(daysUntilOfferExpiry(at(9), NOW)).toBe(9);
  });
});

describe('stacking', () => {
  it('reads an exclusion declared by either side', () => {
    const merit = candidate({ offerKey: 'merit', offerId: 'a', name: 'Merit award' });
    const country = candidate({
      offerKey: 'country',
      offerId: 'b',
      name: 'Country award',
      exclusions: [exclusion({ otherOfferKey: 'merit' })],
    });
    expect(offersConflict(merit, country)).not.toBeNull();
    expect(offersConflict(country, merit)).not.toBeNull();
  });

  it('applies the bigger saving and states why the other did not apply', () => {
    const decision = resolveStacking([
      candidate({
        offerKey: 'country',
        offerId: 'b',
        name: 'Country award',
        saving: money(50_000, 'GBP'),
        exclusions: [exclusion({ otherOfferKey: 'merit' })],
      }),
      candidate({ offerKey: 'merit', offerId: 'a', name: 'Merit award', saving: money(120_000, 'GBP') }),
    ]);

    expect(decision.applied.map((entry) => entry.offerKey)).toEqual(['merit']);
    expect(decision.suppressed).toHaveLength(1);
    expect(decision.suppressed[0]!.offerKey).toBe('country');
    expect(decision.suppressed[0]!.supersededBy).toBe('Merit award');
    expect(decision.suppressed[0]!.reason).toMatch(/Not combinable/i);
  });

  it('refuses a whole category when the exclusion names a type', () => {
    const decision = resolveStacking([
      candidate({
        offerKey: 'partner-discount',
        offerId: 'a',
        type: 'tuition_discount',
        name: 'Partner discount',
        saving: money(200_000, 'GBP'),
        exclusions: [
          exclusion({
            kind: 'not_combinable_with_type',
            otherOfferType: 'scholarship',
            humanSummary: 'Not combinable with any scholarship from this university.',
          }),
        ],
      }),
      candidate({
        offerKey: 'merit',
        offerId: 'b',
        type: 'scholarship',
        name: 'Merit scholarship',
        saving: money(100_000, 'GBP'),
      }),
    ]);

    expect(decision.applied.map((entry) => entry.offerKey)).toEqual(['partner-discount']);
    expect(decision.suppressed[0]!.offerKey).toBe('merit');
  });

  it('is stable and deterministic on a tie', () => {
    const first = resolveStacking([
      candidate({ offerKey: 'b-award', offerId: 'b', name: 'B', programKey: null }),
      candidate({ offerKey: 'a-award', offerId: 'a', name: 'A', programKey: 'msc-data-science' }),
    ]);
    const second = resolveStacking([
      candidate({ offerKey: 'a-award', offerId: 'a', name: 'A', programKey: 'msc-data-science' }),
      candidate({ offerKey: 'b-award', offerId: 'b', name: 'B', programKey: null }),
    ]);
    // Programme-specific wins the tie, and the order the caller passed them in
    // changes nothing.
    expect(first.applied.map((entry) => entry.offerKey)).toEqual(['a-award', 'b-award']);
    expect(second.applied.map((entry) => entry.offerKey)).toEqual(['a-award', 'b-award']);
  });
});

describe('saving arithmetic', () => {
  it('caps a fixed award at the cost it reduces', () => {
    const saving = savingFor(
      priceable({ value: { kind: 'fixed_amount', amount: money(600_000, 'GBP') } }),
      money(500_000, 'GBP'),
    );
    expect(saving).toEqual(money(500_000, 'GBP'));
  });

  it('computes a percentage with integer maths and half-up rounding', () => {
    expect(savingFor(priceable({ value: { kind: 'percentage', basisPoints: 1250 } }), money(1_425_099, 'GBP')))
      .toEqual(money(178_137, 'GBP'));
  });

  it('gives a benefit in kind no monetary weight', () => {
    expect(
      savingFor(
        priceable({
          value: { kind: 'benefit_in_kind', benefit: 'Housing', provider: 'Campus Services' },
        }),
        money(1_425_000, 'GBP'),
      ),
    ).toEqual(money(0, 'GBP'));
  });
});

describe('price breakdown', () => {
  const tuition = money(1_425_000, 'GBP');

  it('traces every saving line to an offer version and its source', () => {
    const breakdown = computePriceBreakdown({
      tuition,
      applicationFee: money(5_000, 'GBP'),
      deposit: null,
      eligible: [priceable()],
      ineligible: [],
      now: NOW,
    });

    const savings = breakdown.lines.filter((line) => line.kind === 'saving');
    expect(savings).toHaveLength(1);
    expect(savings[0]).toMatchObject({
      offerKey: 'merit-award',
      offerVersion: 1,
      sourceRef: 'https://example.edu/scholarships',
    });
    expect(breakdown.grossTotal).toEqual(money(1_430_000, 'GBP'));
    expect(breakdown.totalSaving).toEqual(money(142_500, 'GBP'));
    expect(breakdown.netPrice).toEqual(money(1_287_500, 'GBP'));
  });

  it('never includes an ineligible offer in the net price, and states the unmet condition', () => {
    const breakdown = computePriceBreakdown({
      tuition,
      applicationFee: null,
      deposit: null,
      eligible: [],
      ineligible: [
        {
          offerId: 'offer-2',
          offerKey: 'country-award',
          name: 'Country award',
          unmetCondition: 'This award is for nationals of Nigeria, Ghana and Kenya.',
          remedy: null,
          outcome: 'fail',
        },
      ],
      now: NOW,
    });

    expect(breakdown.netPrice).toEqual(tuition);
    expect(breakdown.totalSaving).toEqual(money(0, 'GBP'));
    expect(breakdown.ineligible[0]!.unmetCondition).toMatch(/nationals of Nigeria/);
  });

  it('compounds two discounts on the same cost rather than double-counting the base', () => {
    const breakdown = computePriceBreakdown({
      tuition: money(1_000_000, 'GBP'),
      applicationFee: null,
      deposit: null,
      eligible: [
        priceable({ offerId: 'a', offerKey: 'a', name: 'Sixty off', value: { kind: 'percentage', basisPoints: 6000 } }),
        priceable({ offerId: 'b', offerKey: 'b', name: 'Fifty off', value: { kind: 'percentage', basisPoints: 5000 } }),
      ],
      ineligible: [],
      now: NOW,
    });

    // 60% of 1,000,000 then 50% of the remaining 400,000 — never 110%.
    expect(breakdown.totalSaving).toEqual(money(800_000, 'GBP'));
    expect(breakdown.netPrice).toEqual(money(200_000, 'GBP'));
    expect(breakdown.netPrice.amountMinor).toBeGreaterThanOrEqual(0);
  });

  it('stops once a cost is fully waived instead of discounting nothing', () => {
    const breakdown = computePriceBreakdown({
      tuition: money(1_000_000, 'GBP'),
      applicationFee: money(5_000, 'GBP'),
      deposit: null,
      eligible: [
        priceable({
          offerId: 'w',
          offerKey: 'fee-waiver',
          name: 'Fee waiver',
          type: 'application_fee_waiver',
          appliesTo: 'application_fee',
          value: { kind: 'full_waiver' },
        }),
        priceable({
          offerId: 'p',
          offerKey: 'partner-fee-discount',
          name: 'Partner fee discount',
          type: 'tuition_discount',
          appliesTo: 'application_fee',
          value: { kind: 'percentage', basisPoints: 5000 },
        }),
      ],
      ineligible: [],
      now: NOW,
    });

    expect(breakdown.totalSaving).toEqual(money(5_000, 'GBP'));
    expect(breakdown.suppressed[0]!.offerKey).toBe('partner-fee-discount');
    expect(breakdown.suppressed[0]!.reason).toMatch(/already reduced to nothing/i);
  });

  it('refuses to convert a currency to make a saving look bigger', () => {
    const breakdown = computePriceBreakdown({
      tuition,
      applicationFee: null,
      deposit: null,
      eligible: [
        priceable({
          offerId: 'usd',
          offerKey: 'usd-award',
          name: 'Dollar award',
          value: { kind: 'fixed_amount', amount: money(500_000, 'USD') },
        }),
      ],
      ineligible: [],
      now: NOW,
    });

    expect(breakdown.totalSaving).toEqual(money(0, 'GBP'));
    expect(breakdown.netPrice).toEqual(tuition);
    expect(breakdown.unpriceable[0]!.reason).toMatch(/do not convert currencies/i);
  });

  it('keeps a benefit in kind out of the arithmetic but still applies it', () => {
    const breakdown = computePriceBreakdown({
      tuition,
      applicationFee: null,
      deposit: null,
      eligible: [
        priceable({
          offerId: 'housing',
          offerKey: 'housing',
          name: 'Guaranteed housing',
          type: 'student_benefit',
          appliesTo: 'none',
          value: { kind: 'benefit_in_kind', benefit: 'Guaranteed housing', provider: 'Campus Services' },
        }),
      ],
      ineligible: [],
      now: NOW,
    });

    expect(breakdown.applied.map((offer) => offer.offerKey)).toEqual(['housing']);
    expect(breakdown.lines.filter((line) => line.kind === 'saving')).toHaveLength(0);
    expect(breakdown.netPrice).toEqual(tuition);
  });
});

describe('attachment lifecycle and savings reporting', () => {
  it('walks the attachment states one hop at a time', () => {
    expect(canTransitionAttachment('attached', 'accepted')).toBe(true);
    expect(canTransitionAttachment('accepted', 'realised')).toBe(true);
    expect(canTransitionAttachment('attached', 'realised')).toBe(false);
    expect(canTransitionAttachment('declined', 'accepted')).toBe(false);
    expect(canTransitionAttachment('realised', 'declined')).toBe(false);
  });

  it('counts only verified offers realised at enrolment', () => {
    const total = savingsSecured(
      [
        { offerId: 'a', offerKey: 'a', state: 'realised', verificationState: 'verified', amount: money(120_000, 'GBP') },
        { offerId: 'b', offerKey: 'b', state: 'accepted', verificationState: 'verified', amount: money(500_000, 'GBP') },
        { offerId: 'c', offerKey: 'c', state: 'realised', verificationState: 'revoked', amount: money(900_000, 'GBP') },
        { offerId: 'd', offerKey: 'd', state: 'realised', verificationState: 'verified', amount: money(80_000, 'GBP') },
      ],
      'GBP',
    );
    expect(total).toEqual(money(200_000, 'GBP'));
  });
});

import type {
  EligibilityCheck,
  OfferBase,
  OfferDuration,
  OfferExclusion,
  OfferExpiryUrgency,
  OfferPublicationState,
  OfferType,
  OfferValue,
  PriceBreakdown,
  VerificationState,
} from '@modex/contracts';

/**
 * The shapes the offer surfaces consume, mirroring the API projections.
 *
 * Kept next to the other client types rather than imported from the API package
 * for the reason `PublicProgramme` is: the web app talks to the API over HTTP
 * and should compile without it.
 */

export interface OfferView {
  offerId: string;
  offerKey: string;
  version: number;
  name: string;
  type: OfferType;
  value: OfferValue;
  appliesTo: OfferBase;
  duration: OfferDuration;
  exclusions: OfferExclusion[];
  sourceRef: string | null;
  programKey: string | null;
  validUntil: string;
  eligible: boolean;
  checks: EligibilityCheck[];
  verifiedBy: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  termsSummary: string | null;
  applicationMethod: string | null;
  redemptionMethod: string | null;
  claimDeadline: string | null;
  expiryUrgency: OfferExpiryUrgency;
}

export interface ProgrammePricing {
  programKey: string;
  breakdown: PriceBreakdown;
  offers: OfferView[];
  tuition: { amountMinor: number; currency: string } | null;
}

/** One row of the university's offer admin table. */
export interface AdminOffer {
  id: string;
  offerKey: string;
  version: number;
  name: string;
  type: OfferType;
  value: OfferValue;
  appliesTo: OfferBase;
  duration: OfferDuration;
  programKey: string | null;
  validFrom: string;
  validUntil: string;
  claimDeadline: string | null;
  publicationState: OfferPublicationState;
  verificationState: VerificationState;
  verifiedBy: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  sourceRef: string | null;
  termsSummary: string | null;
  exclusions: OfferExclusion[];
  attachedApplications: number;
  live: boolean;
  expiryUrgency: OfferExpiryUrgency;
  /** What is still missing before this offer could be published. */
  blockers: string[];
}

export interface SavingsReport {
  realisedCount: number;
  byCurrency: { currency: string; total: { amountMinor: number; currency: string } }[];
}

export interface ApplicationOffers {
  applicationId: string;
  offers: {
    offerKey: string;
    offerId: string;
    offerVersion: number;
    name: string;
    type: OfferType;
    state: 'attached' | 'accepted' | 'declined' | 'expired' | 'realised' | 'superseded';
    value: OfferValue;
    savingMinor: number | null;
    currency: string | null;
    sourceRef: string | null;
    attachedAt: string;
    respondedAt: string | null;
    expiredAt: string | null;
    realisedAt: string | null;
  }[];
  admissionOffer: {
    kind: 'conditional' | 'unconditional';
    conditions: { summary: string; met: boolean; evidence: string | null }[];
    issuedAt: string;
    respondByAt: string | null;
    externalRef: string | null;
    summary: string;
  } | null;
}

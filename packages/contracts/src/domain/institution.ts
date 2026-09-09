import { z } from 'zod';
import { MoneySchema } from '../primitives/money.js';
import { ProvenanceSchema } from './provenance.js';
import { VERIFICATION_STAGES, VERIFICATION_STATES } from './verification.js';

/** Phase 1 §1 — institution, partnership, campus and authorised contacts. */

export const InstitutionSchema = z.object({
  id: z.string(),
  legalName: z.string().min(2),
  displayName: z.string().min(2),
  /** Official domains. Domain confirmation binds the institution to one of these. */
  domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).min(1),
  country: z.string().length(2),
  verificationState: z.enum(VERIFICATION_STATES),
  verificationStage: z.enum(VERIFICATION_STAGES).nullable(),
});

export type Institution = z.infer<typeof InstitutionSchema>;

export const PARTNERSHIP_STATUSES = [
  'prospect',
  'in_onboarding',
  'contract_pending',
  'active',
  'suspended',
  'revoked',
  'expired',
] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];

/**
 * Scopes define exactly what Modex is authorised to do for this institution
 * (Phase 1 §1). Absent a scope, the platform must not act — this is the
 * difference between a partnership and an assumption.
 */
export const PARTNERSHIP_SCOPES = [
  'catalogue_publish',
  'direct_application',
  'brand_use',
  'guide_programme',
  'offer_publication',
  'scholarship_publication',
] as const;
export type PartnershipScope = (typeof PARTNERSHIP_SCOPES)[number];

export const InstitutionPartnershipSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  status: z.enum(PARTNERSHIP_STATUSES),
  /** Pointer to the executed contract in secure storage. Never the contract itself. */
  contractRef: z.string().nullable(),
  startDate: z.iso.datetime().nullable(),
  endDate: z.iso.datetime().nullable(),
  scopes: z.array(z.enum(PARTNERSHIP_SCOPES)),
  /** Markets (ISO country codes) this partnership covers; empty means all. */
  markets: z.array(z.string().length(2)).default([]),
});

export type InstitutionPartnership = z.infer<typeof InstitutionPartnershipSchema>;

export function partnershipIsActive(
  partnership: Pick<InstitutionPartnership, 'status' | 'startDate' | 'endDate'>,
  now: Date = new Date(),
): boolean {
  if (partnership.status !== 'active') return false;
  if (partnership.startDate !== null && new Date(partnership.startDate) > now) return false;
  if (partnership.endDate !== null && new Date(partnership.endDate) <= now) return false;
  return true;
}

export function hasScope(
  partnership: Pick<InstitutionPartnership, 'status' | 'startDate' | 'endDate' | 'scopes'>,
  scope: PartnershipScope,
  now: Date = new Date(),
): boolean {
  return partnershipIsActive(partnership, now) && partnership.scopes.includes(scope);
}

export const CampusSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  name: z.string().min(1),
  addressLine1: z.string().nullable(),
  city: z.string(),
  country: z.string().length(2),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});

export type Campus = z.infer<typeof CampusSchema>;

export const CONTACT_ROLES = [
  'authorised_signatory',
  'admissions',
  'international_office',
  'technical',
  'finance',
] as const;

export const InstitutionContactSchema = z.object({
  id: z.string(),
  institutionId: z.string(),
  fullName: z.string().min(2),
  /** Must sit on one of the institution's confirmed domains. */
  email: z.email(),
  role: z.enum(CONTACT_ROLES),
  verifiedAt: z.iso.datetime().nullable(),
  isAuthorisedSignatory: z.boolean(),
});

export type InstitutionContact = z.infer<typeof InstitutionContactSchema>;

/** A contact only counts as an authorised signatory once verified on-domain. */
export function isVerifiedSignatory(
  contact: Pick<InstitutionContact, 'isAuthorisedSignatory' | 'verifiedAt' | 'email'>,
  institutionDomains: readonly string[],
): boolean {
  if (!contact.isAuthorisedSignatory || contact.verifiedAt === null) return false;
  const domain = contact.email.split('@')[1]?.toLowerCase();
  return domain !== undefined && institutionDomains.some((d) => d.toLowerCase() === domain);
}

export const InstitutionFeeSchema = z.object({
  kind: z.enum(['tuition', 'application', 'deposit']),
  amount: MoneySchema,
  provenance: ProvenanceSchema,
});

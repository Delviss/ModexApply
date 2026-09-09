import { z } from 'zod';
import { MoneySchema } from '../primitives/money.js';
import { ProvenanceSchema } from './provenance.js';
import { RequirementSchema } from './requirements.js';

/** Phase 1 §3 — the effective-dated programme catalogue. */

export const PROGRAM_LEVELS = [
  'foundation',
  'undergraduate',
  'postgraduate_taught',
  'postgraduate_research',
  'doctorate',
  'pathway',
  'short_course',
] as const;
export type ProgramLevel = (typeof PROGRAM_LEVELS)[number];

export const PROGRAM_STATUSES = ['draft', 'in_review', 'published', 'unpublished', 'archived'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const DurationSchema = z.object({
  months: z.number().int().min(1).max(120),
  mode: z.enum(['full_time', 'part_time', 'distance', 'hybrid']),
});

/**
 * Programmes are effective-dated: an edit writes a **new** record with a new
 * `effectiveFrom` and closes the previous one, so an application snapshot taken
 * last week still resolves to exactly what the student was shown (Phase 1 §3,
 * epic §2 principle 3).
 */
export const ProgramSchema = z.object({
  id: z.string(),
  /** Stable across every effective-dated version of the same programme. */
  programKey: z.string(),
  institutionId: z.string(),
  campusId: z.string().nullable(),
  name: z.string().min(2),
  level: z.enum(PROGRAM_LEVELS),
  field: z.string().min(2),
  duration: DurationSchema,
  description: z.string().nullable(),
  status: z.enum(PROGRAM_STATUSES),
  version: z.number().int().min(1),
  effectiveFrom: z.iso.datetime(),
  /** `null` means "current". A closed version is immutable history. */
  effectiveTo: z.iso.datetime().nullable(),
  provenance: ProvenanceSchema,
});

export type Program = z.infer<typeof ProgramSchema>;

export const INTAKE_STATUSES = ['scheduled', 'open', 'closing_soon', 'closed', 'cancelled'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const IntakeSchema = z.object({
  id: z.string(),
  programKey: z.string(),
  startDate: z.iso.datetime(),
  applicationDeadline: z.iso.datetime(),
  status: z.enum(INTAKE_STATUSES),
  capacity: z.number().int().min(0).nullable(),
  provenance: ProvenanceSchema,
});

export type Intake = z.infer<typeof IntakeSchema>;

/** Deadlines are time-bound and drive automatic state changes (Phase 1 §3). */
export const CLOSING_SOON_DAYS = 14;

export function deriveIntakeStatus(
  intake: Pick<Intake, 'applicationDeadline' | 'startDate' | 'status'>,
  now: Date = new Date(),
): IntakeStatus {
  if (intake.status === 'cancelled') return 'cancelled';
  const deadline = new Date(intake.applicationDeadline);
  if (deadline <= now) return 'closed';
  const daysLeft = (deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysLeft <= CLOSING_SOON_DAYS) return 'closing_soon';
  if (new Date(intake.startDate) <= now) return 'closed';
  return 'open';
}

export const ProgramFeesSchema = z.object({
  programKey: z.string(),
  intakeId: z.string().nullable(),
  tuition: MoneySchema,
  applicationFee: MoneySchema.nullable(),
  deposit: MoneySchema.nullable(),
  provenance: ProvenanceSchema,
});

export type ProgramFees = z.infer<typeof ProgramFeesSchema>;

/** What a public programme page is served: the record plus everything dated to it. */
export const ProgramDetailSchema = ProgramSchema.extend({
  institutionName: z.string(),
  campusName: z.string().nullable(),
  intakes: z.array(IntakeSchema),
  fees: ProgramFeesSchema.nullable(),
  requirements: z.array(RequirementSchema),
  staleFields: z.array(z.string()).default([]),
});

export type ProgramDetail = z.infer<typeof ProgramDetailSchema>;

/**
 * A programme may be published only with an active partnership *and* at least
 * one intake whose deadline is still in the future (Phase 1 acceptance criteria).
 */
export function canPublishProgram(input: {
  partnershipActive: boolean;
  hasCataloguePublishScope: boolean;
  intakes: readonly Pick<Intake, 'applicationDeadline' | 'status'>[];
  now?: Date;
}): { ok: boolean; reason: string | null } {
  const now = input.now ?? new Date();
  if (!input.partnershipActive) {
    return { ok: false, reason: 'Institution has no active partnership.' };
  }
  if (!input.hasCataloguePublishScope) {
    return { ok: false, reason: 'Partnership does not grant the catalogue_publish scope.' };
  }
  const hasFutureIntake = input.intakes.some(
    (intake) => intake.status !== 'cancelled' && new Date(intake.applicationDeadline) > now,
  );
  if (!hasFutureIntake) {
    return { ok: false, reason: 'Programme has no intake with a future application deadline.' };
  }
  return { ok: true, reason: null };
}

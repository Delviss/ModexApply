import { Injectable } from '@nestjs/common';
import {
  connectorBlockReason,
  isConnectorEligible,
  rollUpVerdict,
  StudentProfileSchema,
  type EligibilityCheck,
  type EligibilityExplanation,
  type RuleType,
  type StudentProfile,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { systemActor } from '../auth/audit-actor.js';
import { evaluateRequirement, type EvaluationContext } from './rules.js';

/**
 * The eligibility engine (Phase 2 §4, FR-005).
 *
 * Deliberately a separate module from search ranking. They answer different
 * questions — "may I apply?" and "what should I look at first?" — and fusing
 * them is how a platform ends up hiding programmes a student was eligible for
 * because they scored badly on relevance.
 *
 * The verdict is dated and pinned: `programId` is the effective-dated *version*
 * row, and `catalogueVersion` is its version number. `CatalogueService`
 * copies requirements onto each new version, so an explanation computed today
 * stays reproducible against exactly the rules that produced it.
 */
@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Explains one programme for one student.
   *
   * `userId` may be null: an anonymous visitor gets the requirements evaluated
   * as far as they can be, which is not far, and every row reads `missing_data`
   * rather than `fail`.
   */
  async explain(
    programKey: string,
    userId: string | null,
    now: Date = new Date(),
  ): Promise<EligibilityExplanation> {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: { requirements: true },
    });
    if (program === null) throw AppError.notFound('Programme');

    const profile = userId === null ? null : await this.loadProfile(userId);
    const context = await this.buildContext(userId, now);

    // Overrides are loaded once for the whole programme rather than once per
    // requirement: a programme with eight rules should be one query, not eight.
    const overrides = await this.loadOverrides(
      program.requirements.map((requirement) => requirement.id),
      now,
    );

    const checks: EligibilityCheck[] = [];
    for (const requirement of program.requirements) {
      const evaluated = evaluateRequirement(
        {
          id: requirement.id,
          ruleType: requirement.ruleType as RuleType,
          ruleJson: requirement.ruleJson,
          humanSummary: requirement.humanSummary,
          sourceRef: requirement.sourceRef,
        },
        profile,
        context,
      );
      checks.push(await this.applyOverride(evaluated, overrides.get(requirement.id)));
    }

    return {
      programId: program.id,
      intakeId: null,
      verdict: rollUpVerdict(checks),
      checks,
      evaluatedAt: now.toISOString(),
      catalogueVersion: String(program.version),
    };
  }

  /**
   * Explains many programmes at once, for the compare view.
   *
   * The profile and the vault are loaded once rather than per programme: a
   * four-way compare should not be four times the queries.
   */
  async explainMany(
    programKeys: readonly string[],
    userId: string | null,
    now: Date = new Date(),
  ): Promise<Map<string, EligibilityExplanation>> {
    const programs = await this.prisma.program.findMany({
      where: { programKey: { in: [...programKeys] }, effectiveTo: null },
      include: { requirements: true },
    });

    const profile = userId === null ? null : await this.loadProfile(userId);
    const context = await this.buildContext(userId, now);
    const overrides = await this.loadOverrides(
      programs.flatMap((program) => program.requirements.map((r) => r.id)),
      now,
    );

    const result = new Map<string, EligibilityExplanation>();
    for (const program of programs) {
      const checks = program.requirements.map((requirement) => {
        const evaluated = evaluateRequirement(
          {
            id: requirement.id,
            ruleType: requirement.ruleType as RuleType,
            ruleJson: requirement.ruleJson,
            humanSummary: requirement.humanSummary,
            sourceRef: requirement.sourceRef,
          },
          profile,
          context,
        );
        const override = overrides.get(requirement.id);
        return override === undefined
          ? evaluated
          : { ...evaluated, outcome: override.outcome, reason: override.reason };
      });

      result.set(program.programKey, {
        programId: program.id,
        intakeId: null,
        verdict: rollUpVerdict(checks),
        checks,
        evaluatedAt: now.toISOString(),
        catalogueVersion: String(program.version),
      });
    }
    return result;
  }

  private async loadProfile(userId: string): Promise<StudentProfile | null> {
    const row = await this.prisma.studentProfile.findUnique({
      where: { userId },
      include: { academicRecords: true, languageTests: true },
    });
    if (row === null) return null;

    // Parsed through the contract rather than passed straight from Prisma: the
    // evaluators are written against the contract's shape, and a column that
    // drifts should fail here rather than silently evaluate to `missing_data`.
    return StudentProfileSchema.parse({
      id: row.id,
      userId: row.userId,
      dateOfBirth: row.dateOfBirth === null ? null : row.dateOfBirth.toISOString().slice(0, 10),
      nationality: row.nationality,
      countryOfResidence: row.countryOfResidence,
      intendedLevel: row.intendedLevel,
      intendedField: row.intendedField,
      preferredCountries: row.preferredCountries,
      budgetPerYear:
        row.budgetPerYearMinor === null || row.budgetCurrency === null
          ? null
          : { amountMinor: row.budgetPerYearMinor, currency: row.budgetCurrency },
      targetIntake: row.targetIntake,
      academicRecords: row.academicRecords.map((record) => ({
        level: record.level,
        institutionName: record.institutionName,
        countryCode: record.countryCode,
        fieldOfStudy: record.fieldOfStudy,
        grade:
          record.gradeScale === null || record.gradeValue === null
            ? null
            : { scale: record.gradeScale, value: record.gradeValue },
        startedAt: record.startedAt.toISOString(),
        completedAt: record.completedAt === null ? null : record.completedAt.toISOString(),
      })),
      languageTests: row.languageTests.map((test) => ({
        test: test.test,
        overall: test.overall,
        bands: test.bands,
        takenAt: test.takenAt.toISOString(),
        expiresAt: test.expiresAt === null ? null : test.expiresAt.toISOString(),
      })),
      workExperienceMonths: row.workExperienceMonths,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  /**
   * Reads the vault into the two sets the `document_required` rule needs.
   *
   * The split is the point: a document that exists but is quarantined, pending
   * or unverified is **blocked**, not held. Reporting it as held would be false
   * at the exact moment it matters, and `isConnectorEligible` is the single
   * predicate that decides — the same one the connector boundary calls.
   */
  private async buildContext(userId: string | null, now: Date): Promise<EvaluationContext> {
    const usable = new Set<string>();
    const blocked = new Map<string, string>();
    if (userId === null) return { now, usableDocumentTypes: usable, blockedDocumentTypes: blocked };

    const documents = await this.prisma.document.findMany({
      where: { ownerId: userId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    for (const document of documents) {
      const [latest] = document.versions;
      if (latest === undefined) continue;

      const version = {
        id: latest.id,
        documentId: latest.documentId,
        version: latest.version,
        objectKey: latest.objectKey,
        checksum: latest.checksum,
        sizeBytes: latest.sizeBytes,
        contentType: latest.contentType,
        scanState: latest.scanState,
        scannedAt: latest.scannedAt === null ? null : latest.scannedAt.toISOString(),
        scanDetail: latest.scanDetail,
        uploadComplete: latest.uploadComplete,
        createdAt: latest.createdAt.toISOString(),
      };

      if (isConnectorEligible(version)) usable.add(document.type);
      else blocked.set(document.type, connectorBlockReason(version) ?? 'This file is not usable yet.');
    }

    return { now, usableDocumentTypes: usable, blockedDocumentTypes: blocked };
  }

  private async loadOverrides(
    requirementIds: readonly string[],
    now: Date,
  ): Promise<Map<string, { outcome: EligibilityCheck['outcome']; reason: string }>> {
    if (requirementIds.length === 0) return new Map();
    const rows = await this.prisma.eligibilityOverride.findMany({
      where: {
        requirementId: { in: [...requirementIds] },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    return new Map(rows.map((row) => [row.requirementId, { outcome: row.outcome, reason: row.reason }]));
  }

  /**
   * Applies a university partner's override, and audits it.
   *
   * An override is the one place a human changes what a student is told about
   * their own eligibility, so it is never silent: the event records what the
   * engine said and what the override made it say.
   */
  private async applyOverride(
    evaluated: EligibilityCheck,
    override: { outcome: EligibilityCheck['outcome']; reason: string } | undefined,
  ): Promise<EligibilityCheck> {
    if (override === undefined) return evaluated;

    if (override.outcome !== evaluated.outcome) {
      await this.audit.record({
        actor: systemActor(),
        action: 'eligibility.override_applied',
        objectType: 'requirement',
        objectId: evaluated.requirementId,
        metadata: {
          engineOutcome: evaluated.outcome,
          overriddenTo: override.outcome,
        },
      });
    }

    return { ...evaluated, outcome: override.outcome, reason: override.reason };
  }
}

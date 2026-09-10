import { Injectable } from '@nestjs/common';
import {
  profileCompleteness,
  StudentProfileSchema,
  type AcademicRecord,
  type AccessContext,
  type LanguageTest,
  type ProfileCompleteness,
  type StudentProfile,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toAuditActor } from '../auth/audit-actor.js';

export interface ProfilePatch {
  dateOfBirth?: string | null;
  nationality?: string | null;
  countryOfResidence?: string | null;
  intendedLevel?: StudentProfile['intendedLevel'];
  intendedField?: string | null;
  preferredCountries?: string[];
  budgetPerYear?: StudentProfile['budgetPerYear'];
  targetIntake?: string | null;
  workExperienceMonths?: number | null;
  academicRecords?: AcademicRecord[];
  languageTests?: LanguageTest[];
}

/**
 * The student profile (Phase 2 §1, FR-001/FR-002).
 *
 * Every write is a partial update, because the profile form autosaves per
 * section and a student who fills in two fields and closes the tab should keep
 * two fields. Sending the whole object on every keystroke would also mean a
 * half-typed IELTS score overwriting a complete one.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Reads the profile, creating an empty one on first access. */
  async getOrCreate(access: AccessContext): Promise<StudentProfile> {
    const existing = await this.load(access.userId);
    if (existing !== null) return existing;

    await this.prisma.studentProfile.create({ data: { userId: access.userId } });
    await this.audit.record({
      actor: toAuditActor(access),
      action: 'profile.created',
      objectType: 'user',
      objectId: access.userId,
    });

    const created = await this.load(access.userId);
    if (created === null) throw new Error('Profile creation did not persist.');
    return created;
  }

  async completeness(access: AccessContext): Promise<ProfileCompleteness> {
    return profileCompleteness(await this.getOrCreate(access));
  }

  /**
   * Applies a partial update.
   *
   * The collections are replace-wholesale rather than merged: a student
   * removing a qualification has to be able to remove it, and there is no
   * stable client-side id to merge on. They are only touched when present in
   * the patch, so an autosave of the "about you" section leaves them alone.
   */
  async patch(access: AccessContext, patch: ProfilePatch): Promise<StudentProfile> {
    await this.getOrCreate(access);

    const profile = await this.prisma.studentProfile.update({
      where: { userId: access.userId },
      data: {
        ...(patch.dateOfBirth !== undefined
          ? { dateOfBirth: patch.dateOfBirth === null ? null : new Date(patch.dateOfBirth) }
          : {}),
        ...(patch.nationality !== undefined ? { nationality: patch.nationality } : {}),
        ...(patch.countryOfResidence !== undefined
          ? { countryOfResidence: patch.countryOfResidence }
          : {}),
        ...(patch.intendedLevel !== undefined ? { intendedLevel: patch.intendedLevel } : {}),
        ...(patch.intendedField !== undefined ? { intendedField: patch.intendedField } : {}),
        ...(patch.preferredCountries !== undefined
          ? { preferredCountries: patch.preferredCountries }
          : {}),
        ...(patch.targetIntake !== undefined ? { targetIntake: patch.targetIntake } : {}),
        ...(patch.workExperienceMonths !== undefined
          ? { workExperienceMonths: patch.workExperienceMonths }
          : {}),
        ...(patch.budgetPerYear !== undefined
          ? {
              budgetPerYearMinor: patch.budgetPerYear?.amountMinor ?? null,
              budgetCurrency: patch.budgetPerYear?.currency ?? null,
            }
          : {}),
      },
    });

    if (patch.academicRecords !== undefined) {
      await this.prisma.academicRecord.deleteMany({ where: { profileId: profile.id } });
      await this.prisma.academicRecord.createMany({
        data: patch.academicRecords.map((record) => ({
          profileId: profile.id,
          level: record.level,
          institutionName: record.institutionName,
          countryCode: record.countryCode,
          fieldOfStudy: record.fieldOfStudy,
          gradeScale: record.grade?.scale ?? null,
          gradeValue: record.grade?.value ?? null,
          startedAt: new Date(record.startedAt),
          completedAt: record.completedAt === null ? null : new Date(record.completedAt),
        })),
      });
    }

    if (patch.languageTests !== undefined) {
      await this.prisma.languageTest.deleteMany({ where: { profileId: profile.id } });
      await this.prisma.languageTest.createMany({
        data: patch.languageTests.map((test) => ({
          profileId: profile.id,
          test: test.test,
          overall: test.overall,
          bands: test.bands,
          takenAt: new Date(test.takenAt),
          expiresAt: test.expiresAt === null ? null : new Date(test.expiresAt),
        })),
      });
    }

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'profile.updated',
      objectType: 'user',
      objectId: access.userId,
      // Field names only, never values: the audit trail should show that a
      // nationality was set, not what it was set to.
      metadata: { fields: Object.keys(patch) },
    });

    const updated = await this.load(access.userId);
    if (updated === null) throw new Error('Profile update did not persist.');
    return updated;
  }

  private async load(userId: string): Promise<StudentProfile | null> {
    const row = await this.prisma.studentProfile.findUnique({
      where: { userId },
      include: { academicRecords: true, languageTests: true },
    });
    if (row === null) return null;

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
}

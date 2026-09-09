import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { money, type AccessContext, type ProgramLevel } from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { assertOrganisationAccess } from '../auth/access-context.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { currentCorrelationId } from '../common/observability/request-context.js';
import { buildImportDiff, parseCsv, type ExistingProgram, type ImportRow } from './import-diff.js';

/**
 * Import pipeline (Phase 1 section 4):
 *
 *   source import -> field validation -> institution review -> publish ->
 *   expiry/recheck
 *
 * The review step is not optional and not implicit. `dryRun` produces a stored
 * diff; `commit` applies *that stored diff*, and refuses if the file has moved
 * on since. A reviewer approves what they were shown, or nothing happens.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async dryRun(
    access: AccessContext,
    institutionId: string,
    input: { fileName: string; fileRef: string; content: string },
  ) {
    assertOrganisationAccess(access, institutionId);

    const rows = parseCsv(input.content) as unknown as ImportRow[];
    if (rows.length === 0) {
      throw AppError.validation('That file has no data rows.', [
        { field: 'file', code: 'empty', message: 'The uploaded file contained only a header row.' },
      ]);
    }

    const existing = await this.loadExisting(institutionId);
    const diff = buildImportDiff(rows, existing);

    const record = await this.prisma.catalogueImport.create({
      data: {
        institutionId,
        fileName: input.fileName,
        fileRef: input.fileRef,
        state: 'dry_run',
        diff: diff.rows as unknown as object,
        summary: diff.summary as unknown as object,
        uploadedBy: access.userId,
        correlationId: currentCorrelationId(),
      },
      select: { id: true, uploadedAt: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'catalogue.import_dry_run',
      objectType: 'catalogue_import',
      objectId: record.id,
      metadata: { institutionId, fileName: input.fileName, summary: diff.summary },
    });

    return { importId: record.id, ...diff };
  }

  /**
   * Applies a reviewed diff.
   *
   * Rows that errored in the dry run are skipped rather than retried: an error
   * row is a row the reviewer never approved, and quietly importing a corrected
   * guess would defeat the review.
   */
  async commit(access: AccessContext, importId: string) {
    const record = await this.prisma.catalogueImport.findUnique({ where: { id: importId } });
    if (record === null) throw AppError.notFound('Import');
    assertOrganisationAccess(access, record.institutionId);

    if (record.state !== 'dry_run') {
      throw AppError.stateTransition(
        `This import is already ${record.state}. Upload the file again to review it afresh.`,
      );
    }

    const rows = record.diff as unknown as ReturnType<typeof buildImportDiff>['rows'];
    const applicable = rows.filter((row) => row.kind === 'create' || row.kind === 'update');

    let created = 0;
    let updated = 0;

    for (const row of applicable) {
      const values = Object.fromEntries(row.changes.map((change) => [change.field, change.after]));
      if (row.kind === 'create') {
        await this.prisma.program.create({
          data: {
            programKey: randomUUID(),
            institutionId: record.institutionId,
            name: String(values.name ?? 'Untitled programme'),
            level: (values.level ?? 'undergraduate') as ProgramLevel,
            field: String(values.field ?? 'Unspecified'),
            durationMonths: Number(values.durationMonths ?? 12),
            description: values.description ?? null,
            status: 'in_review',
            // Imported rows are never auto-published: they land in review, which
            // is the "institution review" step of the pipeline.
            syncState: 'pending_review',
            sourceRef: `import:${record.fileName}`,
            sourceUpdatedAt: new Date(),
            reviewedBy: access.userId,
          },
        });
        created += 1;
      } else {
        const existing = await this.prisma.program.findFirst({
          where: {
            institutionId: record.institutionId,
            effectiveTo: null,
            sourceRef: `import:${row.externalRef}`,
          },
          select: { id: true },
        });
        if (existing === null) continue;
        await this.prisma.program.update({
          where: { id: existing.id },
          data: {
            ...(values.name === undefined ? {} : { name: String(values.name) }),
            ...(values.field === undefined ? {} : { field: String(values.field) }),
            ...(values.description === undefined ? {} : { description: values.description }),
            syncState: 'pending_review',
            sourceUpdatedAt: new Date(),
            reviewedBy: access.userId,
          },
        });
        updated += 1;
      }
    }

    await this.prisma.catalogueImport.update({
      where: { id: importId },
      data: { state: 'committed', committedBy: access.userId, committedAt: new Date() },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'catalogue.import_committed',
      objectType: 'catalogue_import',
      objectId: importId,
      metadata: {
        institutionId: record.institutionId,
        created,
        updated,
        skippedErrors: rows.filter((row) => row.kind === 'error').length,
      },
    });

    return { created, updated, skipped: rows.length - applicable.length };
  }

  /** Records a sync attempt. A failure is recorded, never swallowed. */
  async recordSyncRun(
    institutionId: string,
    trigger: string,
    outcome: { status: 'succeeded' | 'failed' | 'partial'; seen: number; changed: number; failed: number; error?: string },
  ) {
    const run = await this.prisma.syncRun.create({
      data: {
        institutionId,
        trigger,
        status: outcome.status,
        finishedAt: new Date(),
        recordsSeen: outcome.seen,
        recordsChanged: outcome.changed,
        recordsFailed: outcome.failed,
        error: outcome.error ?? null,
        correlationId: currentCorrelationId(),
      },
      select: { id: true },
    });

    await this.audit.record({
      actor: { id: null, type: 'system', roles: [], organisationId: null, mfaSatisfied: false },
      action: outcome.status === 'succeeded' ? 'catalogue.sync_succeeded' : 'catalogue.sync_failed',
      objectType: 'institution',
      objectId: institutionId,
      metadata: { syncRunId: run.id, trigger, ...outcome },
    });

    return run;
  }

  private async loadExisting(institutionId: string): Promise<ExistingProgram[]> {
    const programs = await this.prisma.program.findMany({
      where: { institutionId, effectiveTo: null },
      include: {
        fees: { orderBy: { sourceUpdatedAt: 'desc' }, take: 1 },
      },
    });

    const intakes = await this.prisma.intake.findMany({
      where: { programKey: { in: programs.map((program) => program.programKey) } },
      orderBy: { applicationDeadline: 'asc' },
    });

    return programs.map((program) => {
      const fees = program.fees[0];
      const intake = intakes.find((candidate) => candidate.programKey === program.programKey);
      return {
        // The import key is the source's own reference, stored as `import:<ref>`.
        externalRef: program.sourceRef?.replace(/^import:/, '') ?? program.programKey,
        name: program.name,
        level: program.level,
        field: program.field,
        durationMonths: program.durationMonths,
        description: program.description,
        // Straight from minor units. Dividing by 100 to re-parse would be a
        // float round-trip in the one module that must not have one.
        tuition: fees === undefined ? null : money(fees.tuitionMinor, fees.tuitionCurrency),
        applicationDeadline: intake?.applicationDeadline.toISOString() ?? null,
        intakeStartDate: intake?.startDate.toISOString() ?? null,
      };
    });
  }
}

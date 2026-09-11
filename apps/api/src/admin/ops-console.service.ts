import { Injectable } from '@nestjs/common';
import {
  NotificationTemplateSchema,
  connectorHealth,
  isSubmissionStuck,
  unknownPlaceholders,
  type AccessContext,
  type ConnectorHealthState,
  type NotificationTemplateInput,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';

/** Attempts in this window feed the health calculation. */
export const CONNECTOR_HEALTH_WINDOW_HOURS = 24;

/**
 * The operations console (Phase 6 §3).
 *
 * Everything here answers one of two questions — "is the machinery running?"
 * and "which students are stuck because it isn't?" — and the second one is why
 * the exceptions queue is not merely a list of failed rows. Every exception
 * carries a named remediation, because an exceptions queue that tells an
 * operator something is broken without telling them what to do about it is a
 * queue that gets muted.
 */
@Injectable()
export class OpsConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Catalogue sync: last run per institution, freshness breaches, stale records. */
  async catalogueHealth(now: Date = new Date()) {
    const [runs, staleProgrammes, staleFees, pendingImports] = await Promise.all([
      this.prisma.syncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          institutionId: true,
          trigger: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          recordsSeen: true,
          recordsChanged: true,
          recordsFailed: true,
          error: true,
          institution: { select: { displayName: true } },
        },
      }),
      this.prisma.program.count({ where: { syncState: 'stale' } }),
      this.prisma.programFees.count({ where: { syncState: 'stale' } }),
      this.prisma.catalogueImport.count({ where: { state: 'dry_run' } }),
    ]);

    const failing = runs.filter((run) => run.status === 'failed' || run.recordsFailed > 0);

    return {
      generatedAt: now.toISOString(),
      stale: { programmes: staleProgrammes, fees: staleFees },
      pendingImports,
      failingRuns: failing.length,
      runs: runs.map((run) => ({
        ...run,
        institution: run.institution.displayName,
        durationMs:
          run.finishedAt === null ? null : run.finishedAt.getTime() - run.startedAt.getTime(),
      })),
    };
  }

  /**
   * Per-partner connector health: success rate, latency, retries, dead letters.
   *
   * Latency is measured over finished attempts only. Including in-flight ones
   * would make a hung connector look fast — its slowest calls have not returned
   * to be counted.
   */
  async connectorHealth(now: Date = new Date()) {
    const since = new Date(now.getTime() - CONNECTOR_HEALTH_WINDOW_HOURS * 3_600_000);

    const connectors = await this.prisma.connectorConfig.findMany({
      select: {
        id: true,
        institutionId: true,
        type: true,
        displayName: true,
        enabled: true,
        featureFlag: true,
        lastPolledAt: true,
        institution: { select: { displayName: true } },
      },
    });

    const attempts = await this.prisma.submissionAttempt.findMany({
      where: { startedAt: { gte: since } },
      select: {
        id: true,
        state: true,
        startedAt: true,
        finishedAt: true,
        attemptNo: true,
        failureCode: true,
        application: { select: { connectorId: true, institutionId: true } },
      },
      take: 5_000,
    });

    return connectors.map((connector) => {
      const mine = attempts.filter((a) => a.application.connectorId === connector.id);
      const succeeded = mine.filter((a) => a.state === 'accepted').length;
      const deadLettered = mine.filter((a) => a.state === 'dead_lettered').length;
      const retries = mine.filter((a) => a.attemptNo > 1).length;
      const latencies = mine
        .filter((a) => a.finishedAt !== null)
        .map((a) => (a.finishedAt as Date).getTime() - a.startedAt.getTime())
        .sort((a, b) => a - b);

      const p95 =
        latencies.length === 0
          ? null
          : (latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? null);

      const health: ConnectorHealthState = connectorHealth({
        attempts: mine.length,
        succeeded,
        deadLettered,
        p95LatencyMs: p95,
      });

      const failureCodes = new Map<string, number>();
      for (const attempt of mine) {
        if (attempt.failureCode === null) continue;
        failureCodes.set(attempt.failureCode, (failureCodes.get(attempt.failureCode) ?? 0) + 1);
      }

      return {
        connectorId: connector.id,
        institution: connector.institution.displayName,
        institutionId: connector.institutionId,
        type: connector.type,
        displayName: connector.displayName,
        enabled: connector.enabled,
        featureFlag: connector.featureFlag,
        lastPolledAt: connector.lastPolledAt?.toISOString() ?? null,
        health,
        window: { since: since.toISOString(), hours: CONNECTOR_HEALTH_WINDOW_HOURS },
        attempts: mine.length,
        succeeded,
        deadLettered,
        retries,
        successRate: mine.length === 0 ? null : Math.round((succeeded / mine.length) * 1000) / 10,
        p95LatencyMs: p95,
        failureCodes: [...failureCodes.entries()].map(([code, count]) => ({ code, count })),
      };
    });
  }

  /**
   * Applications stuck, failed, or submitted with no receipt.
   *
   * Each row names its remediation. The strings are short on purpose: an
   * operator reads them at three in the morning, next to a queue that is longer
   * than they would like.
   */
  async exceptions(now: Date = new Date()) {
    const [pending, failed, deadLettered] = await Promise.all([
      this.prisma.application.findMany({
        where: { state: 'submitted_pending' },
        orderBy: { updatedAt: 'asc' },
        take: 200,
        select: {
          id: true,
          institutionId: true,
          state: true,
          updatedAt: true,
          externalRef: true,
          institution: { select: { displayName: true } },
        },
      }),
      this.prisma.application.findMany({
        where: { state: 'failed' },
        orderBy: { updatedAt: 'asc' },
        take: 200,
        select: {
          id: true,
          institutionId: true,
          state: true,
          updatedAt: true,
          institution: { select: { displayName: true } },
          attempts: {
            orderBy: { attemptNo: 'desc' },
            take: 1,
            select: { failureCode: true, failureReason: true, nextRetryAt: true },
          },
        },
      }),
      this.prisma.submissionAttempt.findMany({
        where: { state: 'dead_lettered' },
        orderBy: { startedAt: 'desc' },
        take: 200,
        select: {
          id: true,
          applicationId: true,
          attemptNo: true,
          failureCode: true,
          failureReason: true,
          startedAt: true,
          correlationId: true,
        },
      }),
    ]);

    const stuck = pending.filter((row) => isSubmissionStuck(row, now));

    return {
      generatedAt: now.toISOString(),
      stuckPending: stuck.map((row) => ({
        applicationId: row.id,
        institution: row.institution.displayName,
        waitingSince: row.updatedAt.toISOString(),
        hasReference: row.externalRef !== null,
        remediation:
          row.externalRef === null
            ? 'No reference from the partner. Check connector health, then re-poll status; if the partner confirms receipt out of band, record the reference against the application.'
            : 'Reference present but the state never advanced. Re-run the status poll for this application.',
      })),
      failed: failed.map((row) => ({
        applicationId: row.id,
        institution: row.institution.displayName,
        failedAt: row.updatedAt.toISOString(),
        failureCode: row.attempts[0]?.failureCode ?? null,
        failureReason: row.attempts[0]?.failureReason ?? null,
        nextRetryAt: row.attempts[0]?.nextRetryAt?.toISOString() ?? null,
        remediation:
          'Read the failure code against the partner runbook. Retries are automatic until the dead-letter threshold; a validation failure needs the student to fix the payload, not a retry.',
      })),
      deadLettered: deadLettered.map((row) => ({
        ...row,
        startedAt: row.startedAt.toISOString(),
        remediation:
          'Automatic retries are exhausted. Confirm the partner is accepting traffic, then requeue from the connector page; the idempotency key means a requeue cannot duplicate the application.',
      })),
    };
  }

  /** Turning a connector on or off. Both are audited; neither is silent. */
  async setConnectorEnabled(access: AccessContext, connectorId: string, enabled: boolean) {
    const connector = await this.prisma.connectorConfig.findUnique({
      where: { id: connectorId },
      select: { id: true, institutionId: true, enabled: true, displayName: true },
    });
    if (connector === null) throw AppError.notFound('Connector');

    const updated = await this.prisma.connectorConfig.update({
      where: { id: connectorId },
      data: { enabled },
      select: { id: true, enabled: true, displayName: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: enabled ? 'connector.enabled' : 'connector.disabled',
      objectType: 'connector',
      objectId: connectorId,
      metadata: {
        institutionId: connector.institutionId,
        was: connector.enabled,
        now: enabled,
      },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  async templates() {
    return this.prisma.notificationTemplate.findMany({
      where: { active: true },
      orderBy: [{ key: 'asc' }, { channel: 'asc' }],
    });
  }

  /**
   * Editing a template writes a new version and retires the old one.
   *
   * A student asking "what did that email say" months later is asking about the
   * version they received; overwriting in place makes that unanswerable.
   */
  async upsertTemplate(access: AccessContext, input: NotificationTemplateInput) {
    const parsed = NotificationTemplateSchema.parse(input);
    const unknown = unknownPlaceholders(parsed.body);
    if (unknown.length > 0) {
      throw AppError.validation('That template uses placeholders we do not fill.', [
        {
          field: 'body',
          code: 'unknown_placeholder',
          message: `Unknown: ${unknown.join(', ')}.`,
        },
      ]);
    }

    const current = await this.prisma.notificationTemplate.findFirst({
      where: { key: parsed.key, channel: parsed.channel, locale: parsed.locale, active: true },
      orderBy: { version: 'desc' },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      if (current !== null) {
        await tx.notificationTemplate.update({
          where: { id: current.id },
          data: { active: false },
        });
      }
      return tx.notificationTemplate.create({
        data: {
          key: parsed.key,
          channel: parsed.channel,
          locale: parsed.locale,
          subject: parsed.subject,
          body: parsed.body,
          version: (current?.version ?? 0) + 1,
          active: true,
          updatedBy: access.userId,
        },
      });
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'notification.template_updated',
      objectType: 'notification_template',
      objectId: created.id,
      metadata: {
        key: parsed.key,
        channel: parsed.channel,
        locale: parsed.locale,
        version: created.version,
        previousVersion: current?.version ?? null,
      },
    });

    return created;
  }

  /** Delivery state, grouped, so a bounce spike is visible as a spike. */
  async deliveryHealth(now: Date = new Date()) {
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const grouped = await this.prisma.notificationDelivery.groupBy({
      by: ['templateKey', 'state'],
      where: { queuedAt: { gte: since } },
      _count: { _all: true },
    });

    const byTemplate = new Map<string, Record<string, number>>();
    for (const row of grouped) {
      const entry = byTemplate.get(row.templateKey) ?? {};
      entry[row.state] = row._count._all;
      byTemplate.set(row.templateKey, entry);
    }

    return {
      window: { since: since.toISOString(), until: now.toISOString() },
      templates: [...byTemplate.entries()].map(([templateKey, states]) => ({
        templateKey,
        states,
        failureRate: failureRate(states),
      })),
    };
  }
}

function failureRate(states: Record<string, number>): number | null {
  const total = Object.values(states).reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const bad = (states.bounced ?? 0) + (states.failed ?? 0);
  return Math.round((bad / total) * 1000) / 10;
}

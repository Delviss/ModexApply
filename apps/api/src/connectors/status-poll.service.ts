import { Injectable, Logger } from '@nestjs/common';
import {
  MIN_POLL_INTERVAL_SECONDS,
  type ConnectorType,
  type InboundStatusEvent,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { systemActor } from '../auth/audit-actor.js';
import { ConnectorRegistry } from './connector.registry.js';
import { InboundStatusService } from './inbound-status.service.js';

/**
 * The status poll, for connectors without webhooks (Phase 4 §3).
 *
 * Rate limiting is per partner and is a property of *their* configuration:
 * `pollIntervalSeconds` on the connector row, floored at a minute so a
 * misconfiguration cannot turn into a denial-of-service against a university.
 * `lastPolledAt` is written before the calls rather than after, so a slow
 * partner cannot be polled again by a second sweep running concurrently.
 *
 * Events discovered here go through exactly the same `InboundStatusService.apply`
 * a webhook would use. There is no second path into the state machine, and a
 * partner who later adds webhooks changes nothing downstream.
 */
@Injectable()
export class StatusPollService {
  private readonly logger = new Logger(StatusPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: ConnectorRegistry,
    private readonly inbound: InboundStatusService,
  ) {}

  async sweep(now: Date = new Date()): Promise<{ polled: number; applied: number }> {
    const connectors = await this.prisma.connectorConfig.findMany({ where: { enabled: true } });

    let polled = 0;
    let applied = 0;

    for (const connector of connectors) {
      const interval = Math.max(connector.pollIntervalSeconds, MIN_POLL_INTERVAL_SECONDS);
      const due =
        connector.lastPolledAt === null ||
        now.getTime() - connector.lastPolledAt.getTime() >= interval * 1000;
      if (!due) continue;

      const adapter = this.registry.adapterFor(connector.type as ConnectorType);
      if (adapter.poll === undefined) continue;

      // Claimed before the work, not after: two sweeps overlapping must not
      // both decide this partner is due.
      const claimed = await this.prisma.connectorConfig.updateMany({
        where: { id: connector.id, lastPolledAt: connector.lastPolledAt },
        data: { lastPolledAt: now },
      });
      if (claimed.count === 0) continue;

      // Only applications actually waiting on the university. Polling a
      // finished application would spend a partner's rate limit on nothing.
      const waiting = await this.prisma.application.findMany({
        where: {
          connectorId: connector.id,
          externalRef: { not: null },
          state: { in: ['submitted', 'under_review', 'more_info'] },
        },
        select: { externalRef: true },
      });

      for (const application of waiting) {
        if (application.externalRef === null) continue;
        polled += 1;
        try {
          const statuses = await adapter.poll({
            externalRef: application.externalRef,
            endpointUrl: connector.endpointUrl,
            credentialRef: connector.credentialRef,
            settings: asRecord(connector.settings),
          });
          for (const status of statuses) {
            const result = await this.inbound.apply(connector.id, status as InboundStatusEvent, now);
            if (result.applied) applied += 1;
          }
        } catch (error) {
          // One unreachable partner must not stop the sweep for the others.
          this.logger.warn(
            `Poll failed for connector ${connector.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      await this.audit.record({
        actor: systemActor(),
        action: 'connector.poll_completed',
        objectType: 'connector',
        objectId: connector.id,
        metadata: { pending: waiting.length, intervalSeconds: interval },
      });
    }

    return { polled, applied };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

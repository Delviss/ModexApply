import { Injectable, Logger } from '@nestjs/common';
import { GUIDE_EXPIRY_WARNING_DAYS, guideLifecycleDecision } from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { QUEUES, QueueService } from '../queue/queue.service.js';
import { systemActor } from '../auth/audit-actor.js';
import { GuidesService } from './guides.service.js';

export interface ReverificationSweepResult {
  scanned: number;
  notified: number;
  restricted: number;
  suspended: number;
}

/**
 * The reverification sweep (Phase 3 §1).
 *
 * "**Expiry is mandatory.** Reverification job: notify → restrict → suspend if
 * not renewed. An expired guide's messaging is suspended automatically, not by
 * human intervention."
 *
 * Everything about *when* to act lives in `guideLifecycleDecision`, a pure
 * function in the contracts package with `now` injected. This class only carries
 * out the decision, which is what makes the acceptance criterion provable by
 * moving a clock rather than by waiting six months or mocking a scheduler.
 *
 * Idempotent by construction: the decision function reads the state it is about
 * to set, so a sweep that runs twice in the same hour acts once.
 */
@Injectable()
export class ReverificationService {
  private readonly logger = new Logger(ReverificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guides: GuidesService,
    private readonly queue: QueueService,
  ) {}

  async sweep(now: Date = new Date()): Promise<ReverificationSweepResult> {
    const result: ReverificationSweepResult = {
      scanned: 0,
      notified: 0,
      restricted: 0,
      suspended: 0,
    };

    // Only states the clock can still act on, and only guides whose evidence is
    // inside the warning horizon. A guide verified last week is not loaded at
    // all — the index on (state, evidenceExpiresAt) is what keeps this one scan
    // rather than a table walk as the roster grows.
    const horizon = new Date(now.getTime() + GUIDE_EXPIRY_WARNING_DAYS * 86_400_000);
    const guides = await this.prisma.studentGuide.findMany({
      where: {
        state: { in: ['active', 'restricted'] },
        evidenceExpiresAt: { not: null, lte: horizon },
      },
      select: { id: true, state: true, evidenceExpiresAt: true, expiryNotifiedAt: true },
    });

    for (const guide of guides) {
      result.scanned += 1;
      const decision = guideLifecycleDecision(
        {
          state: guide.state,
          evidenceExpiresAt: guide.evidenceExpiresAt,
          expiryNotifiedAt: guide.expiryNotifiedAt,
        },
        now,
      );

      switch (decision.action) {
        case 'notify': {
          await this.prisma.studentGuide.update({
            where: { id: guide.id },
            data: { expiryNotifiedAt: now },
          });
          await this.queue.enqueue(QUEUES.notifications, 'guide-reverification-due', {
            guideId: guide.id,
            expiresAt: guide.evidenceExpiresAt,
          });
          await this.audit.record({
            actor: systemActor(),
            action: 'guide.reverification_notified',
            objectType: 'guide',
            objectId: guide.id,
            metadata: { expiresAt: guide.evidenceExpiresAt?.toISOString(), reason: decision.reason },
          });
          result.notified += 1;
          break;
        }
        case 'restrict': {
          await this.guides.restrict(systemActor(), guide.id, decision.reason);
          result.restricted += 1;
          break;
        }
        case 'suspend': {
          // The same suspension path a trust agent uses: out of the directory,
          // conversations told, sessions cancelled. No human step, and no
          // second, weaker version of "suspended".
          await this.guides.suspend(systemActor(), guide.id, decision.reason);
          result.suspended += 1;
          break;
        }
        case 'none':
          break;
      }
    }

    if (result.notified + result.restricted + result.suspended > 0) {
      this.logger.log(
        `Reverification sweep: ${result.notified} notified, ${result.restricted} restricted, ${result.suspended} suspended`,
      );
    }

    return result;
  }

  /**
   * Suspends every guide at an institution whose partnership was revoked.
   *
   * Phase 1 enqueued this job and left the handler unwritten because the guide
   * roster did not exist yet; this is the other half. Programme unpublish stays
   * inline and transactional in `InstitutionsService`, because a revoked
   * partnership must not leave live programmes visible for however long the
   * queue is backed up — but suspending guides means writing a system message
   * into every open conversation, which is exactly the work a queue is for.
   */
  async suspendRosterForInstitution(institutionId: string, reason: string) {
    const guides = await this.prisma.studentGuide.findMany({
      where: { institutionId, state: { in: ['pending', 'active', 'restricted'] } },
      select: { id: true },
    });

    for (const guide of guides) {
      await this.guides.suspend(systemActor(), guide.id, reason);
    }

    return { suspended: guides.length };
  }
}

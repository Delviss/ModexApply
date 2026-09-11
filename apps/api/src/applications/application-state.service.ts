import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  evaluateTransition,
  humanState,
  type ApplicationState,
  type TransitionActor,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';

export interface TransitionRequest {
  applicationId: string;
  to: ApplicationState;
  actor: AuditActor;
  /** Who is *entitled* to ask, which is a different question from who is calling. */
  authority: TransitionActor;
  /** Extra columns the transition sets atomically with the state. */
  data?: Prisma.ApplicationUpdateInput;
  metadata?: Record<string, unknown>;
}

/**
 * **The one place an application changes state.**
 *
 * Every route, job and connector callback goes through this method. The table
 * it enforces lives in `@modex/contracts` so the tests can walk it without a
 * database, and the guarantee that nothing bypasses it is this: no other
 * service in the codebase calls `prisma.application.update` with a `state`.
 *
 * Three things happen together or not at all — the compare-and-set, the state
 * change, and the audit event. Splitting them would allow an application whose
 * state moved with no record of why, which on a platform whose product is an
 * auditable submission record is the whole game.
 */
@Injectable()
export class ApplicationStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async transition(request: TransitionRequest): Promise<{ from: ApplicationState; to: ApplicationState }> {
    const from = await this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findUnique({
        where: { id: request.applicationId },
        select: { state: true },
      });
      if (current === null) throw AppError.notFound('Application');

      const refusal = evaluateTransition(
        current.state as ApplicationState,
        request.to,
        request.authority,
      );
      if (refusal !== null) {
        throw AppError.stateTransition(refusal.message, {
          from: current.state,
          to: request.to,
          code: refusal.code,
        });
      }

      // Compare-and-set on the state we just read. Two connector callbacks
      // arriving together would otherwise both pass the check above and the
      // second would overwrite the first; here the loser updates zero rows.
      const updated = await tx.application.updateMany({
        where: { id: request.applicationId, state: current.state },
        data: { state: request.to, ...(request.data as Prisma.ApplicationUpdateManyMutationInput) },
      });
      if (updated.count === 0) {
        throw new AppError(
          'conflict',
          'The application changed while we were updating it. Reload and try again.',
        );
      }

      return current.state as ApplicationState;
    });

    await this.audit.record({
      actor: request.actor,
      action: 'application.state_changed',
      objectType: 'application',
      objectId: request.applicationId,
      metadata: {
        from,
        to: request.to,
        authority: request.authority,
        humanFrom: humanState(from),
        humanTo: humanState(request.to),
        ...request.metadata,
      },
    });

    return { from, to: request.to };
  }
}

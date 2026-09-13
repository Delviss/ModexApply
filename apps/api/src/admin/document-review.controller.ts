import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AssessmentDecisionSchema, type AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions, RequireStepUp } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { DocumentReviewService } from './document-review.service.js';

const QueueQuerySchema = z.object({
  state: z.enum(['awaiting', 'decided', 'all']).default('awaiting'),
  institutionId: z.string().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The document assessment console (Phase 8, #20).
 *
 * `document:read` is the permission, not a console-specific one, because the
 * thing being done is reading a student's document — the same act the vault
 * governs — and inventing `assessment:read` next to it would create two answers
 * to one question.
 *
 * Opening a file needs a fresh step-up. It sits alongside viewing verification
 * evidence in `@RequireStepUp` for the same reason: a walked-away-from laptop
 * must not be able to page through passport scans.
 */
@Controller({ path: 'admin/documents', version: '1' })
export class DocumentReviewController {
  constructor(private readonly review: DocumentReviewService) {}

  /**
   * The queue itself needs no step-up: triaging by type, age and SLA is the
   * normal day, and it discloses no document. Only opening one does.
   */
  @Get('queue')
  @RequirePermissions('document:read', 'application:read')
  @RequireStepUp('console_entry')
  async queue(
    @Actor() access: AccessContext,
    @Query(new ZodValidationPipe(QueueQuerySchema)) query: z.infer<typeof QueueQuerySchema>,
  ) {
    return this.review.queue(access, {
      state: query.state,
      institutionId: query.institutionId,
      limit: query.limit,
    });
  }

  @Post(':versionId/open')
  @RequirePermissions('document:read', 'evidence:read')
  @RequireStepUp('evidence_view')
  async open(
    @Actor() access: AccessContext,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(z.object({ institutionId: z.string().nullable().default(null) })))
    body: { institutionId: string | null },
  ) {
    return this.review.open(access, versionId, body.institutionId);
  }

  @Post(':versionId/decision')
  @RequirePermissions('document:read', 'evidence:read')
  @RequireStepUp('evidence_view')
  async decide(
    @Actor() access: AccessContext,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(AssessmentDecisionSchema.and(z.object({ institutionId: z.string().nullable().default(null) }))))
    body: z.infer<typeof AssessmentDecisionSchema> & { institutionId: string | null },
  ) {
    return this.review.decide(
      access,
      versionId,
      { decision: body.decision, reasons: body.reasons, note: body.note },
      body.institutionId,
    );
  }
}

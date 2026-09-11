import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SUBMISSION_CONSENTS, type AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { AppError } from '../common/errors/app-error.js';
import { ApplicationsService } from './applications.service.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';

const StartSchema = z.object({
  programKey: z.string().min(1),
  intakeId: z.uuid(),
});

const ConsentSchema = z.object({
  accepted: z.array(z.enum(SUBMISSION_CONSENTS.map((consent) => consent.id))).min(1),
});

const WithdrawSchema = z.object({ reason: z.string().min(3).max(500) });

const OfferSchema = z.object({ decision: z.enum(['accepted', 'declined']) });

const SubmitSchema = z.object({
  /** Set by an operator submitting on a student's behalf. Never by a student. */
  operatorFor: z.uuid().optional(),
});

/**
 * Applications (Phase 4, FR-009 – FR-012 and FR-018).
 *
 * `submit` is the only route in the product that carries a mandatory
 * `Idempotency-Key`, and the reason is the acceptance criterion: replaying a
 * submission with the same key must produce no duplicate at the university and
 * return the original result. Making the header optional would leave that
 * guarantee to whether a client remembered to send it.
 */
@Controller({ version: '1' })
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('applications')
  @RequirePermissions('application:read')
  async list(@Actor() access: AccessContext) {
    return { data: await this.applications.list(access) };
  }

  @Post('applications')
  @RequirePermissions('application:write')
  async start(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(StartSchema)) body: z.infer<typeof StartSchema>,
  ) {
    return this.applications.start(access, body);
  }

  @Get('applications/:id')
  @RequirePermissions('application:read')
  async detail(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.applications.detail(access, id);
  }

  @Get('applications/:id/readiness')
  @RequirePermissions('application:read')
  async readiness(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.applications.readiness(access, id);
  }

  @Post('applications/:id/ready')
  @RequirePermissions('application:write')
  async markReady(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.applications.markReady(access, id);
  }

  @Post('applications/:id/consents')
  @RequirePermissions('application:write')
  async consents(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConsentSchema)) body: z.infer<typeof ConsentSchema>,
  ) {
    return { data: await this.applications.recordConsents(access, id, body.accepted) };
  }

  @RateLimit(['application.submit'])
  @Post('applications/:id/submit')
  @RequirePermissions('application:submit')
  async submit(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(SubmitSchema)) body: z.infer<typeof SubmitSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      throw AppError.validation('A submission needs an Idempotency-Key header.', [
        {
          field: 'idempotency-key',
          code: 'required',
          message:
            'Send a unique key with each submission so a retry cannot create a second application at the university.',
        },
      ]);
    }

    const outcome = await this.idempotency.run(
      idempotencyKey,
      `POST /v1/applications/${id}/submit:${access.userId}`,
      body,
      async () => ({
        status: 200,
        body: await this.applications.submit(access, id, {
          ...(body.operatorFor === undefined ? {} : { operatorFor: body.operatorFor }),
        }),
      }),
    );

    // Says plainly that nothing new happened, which a client retrying after a
    // timeout needs to know before it shows the student anything.
    response.setHeader('idempotent-replay', outcome.replayed ? 'true' : 'false');
    return outcome.body;
  }

  @Get('applications/:id/snapshots/:submissionNo')
  @RequirePermissions('application:read')
  async reproduce(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Param('submissionNo') submissionNo: string,
  ) {
    const parsed = Number(submissionNo);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw AppError.validation('Submission numbers start at 1.', [
        { field: 'submissionNo', code: 'invalid', message: 'Not a submission number.' },
      ]);
    }
    return this.applications.reproduce(access, id, parsed);
  }

  @Get('applications/:id/trace')
  @RequirePermissions('application:read')
  async trace(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.applications.trace(access, id);
  }

  @Post('applications/:id/withdraw')
  @RequirePermissions('application:write')
  async withdraw(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WithdrawSchema)) body: z.infer<typeof WithdrawSchema>,
  ) {
    return this.applications.withdraw(access, id, body.reason);
  }

  @Post('applications/:id/offer-response')
  @RequirePermissions('application:write')
  async respondToOffer(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OfferSchema)) body: z.infer<typeof OfferSchema>,
  ) {
    return this.applications.respondToOffer(access, id, body.decision);
  }

  @Post('applications/:id/tasks/:taskId/complete')
  @RequirePermissions('application:write')
  async completeTask(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ) {
    return this.applications.completeTask(access, id, taskId);
  }
}

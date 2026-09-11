import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ReportSchema, TRUST_CASE_STATES, type AccessContext } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { TrustService } from './trust.service.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';

const TransitionSchema = z.object({
  state: z.enum(TRUST_CASE_STATES),
  note: z.string().max(2_000).optional(),
});

/**
 * Reporting and the trust queue (FR-015, Phase 3 §4).
 *
 * `POST /reports` is held by every role that can hold a permission at all,
 * including guides: "any user can report any person, offer, institutional claim
 * or message" is not a student-only right, and a guide being pressured by a
 * student needs the same button.
 */
@Controller({ version: '1' })
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @RateLimit(['trust.report'])
  @Post('reports')
  @RequirePermissions('trust_case:write')
  async report(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(ReportSchema)) body: z.infer<typeof ReportSchema>,
  ) {
    return this.trust.report(access, body);
  }

  @Get('trust/cases')
  @RequirePermissions('trust_case:read')
  async list(@Query('state') state?: string, @Query('targetId') targetId?: string) {
    const parsed = state === undefined ? undefined : z.enum(TRUST_CASE_STATES).parse(state);
    return { data: await this.trust.list({ state: parsed, targetId }) };
  }

  @Get('trust/cases/:id')
  @RequirePermissions('trust_case:read')
  async detail(@Param('id') id: string) {
    return this.trust.detail(id);
  }

  @Post('trust/cases/:id/transition')
  @RequirePermissions('trust_case:write')
  async transition(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransitionSchema)) body: z.infer<typeof TransitionSchema>,
  ) {
    return this.trust.transition(access, id, body.state, body.note);
  }
}

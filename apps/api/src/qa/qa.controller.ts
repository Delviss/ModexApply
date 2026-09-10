import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { GUIDE_TOPICS, type AccessContext, type GuideTopic } from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { Public, RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { QaService } from './qa.service.js';

const AskSchema = z.object({
  institutionId: z.uuid(),
  programKey: z.string().max(200).nullable().optional(),
  topic: z.enum(GUIDE_TOPICS),
  body: z.string().trim().min(10).max(500),
});

const AnswerSchema = z.object({
  body: z.string().trim().min(1).max(4_000),
  consentToPublish: z.boolean(),
});

/**
 * Public Q&A (Phase 3 §3).
 *
 * The read is `@Public` on purpose: a moderated, attributed answer about what
 * halls cost is exactly the kind of thing a student should be able to read
 * before deciding whether this platform is worth an account.
 */
@Controller({ version: '1' })
export class QaController {
  constructor(private readonly qa: QaService) {}

  @Get('qa')
  @Public()
  async published(@Query('institutionId') institutionId?: string, @Query('topic') topic?: string) {
    const parsed = topic === undefined ? undefined : (z.enum(GUIDE_TOPICS).parse(topic) as GuideTopic);
    return { data: await this.qa.published({ institutionId, topic: parsed }) };
  }

  @Post('qa/questions')
  @RequirePermissions('message:write')
  async ask(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(AskSchema)) body: z.infer<typeof AskSchema>,
  ) {
    return this.qa.ask(access, body);
  }

  @Get('qa/questions/open')
  @RequirePermissions('qa:answer')
  async open(@Actor() access: AccessContext) {
    return { data: await this.qa.openQuestions(access) };
  }

  @Post('qa/questions/:id/answers')
  @RequirePermissions('qa:answer')
  async answer(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnswerSchema)) body: z.infer<typeof AnswerSchema>,
  ) {
    return this.qa.answer(access, id, body);
  }

  @Post('qa/answers/:id/consent')
  @RequirePermissions('qa:answer')
  async consent(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ consent: z.boolean() }))) body: { consent: boolean },
  ) {
    return this.qa.setConsent(access, id, body.consent);
  }

  @Post('qa/answers/:id/moderate')
  @RequirePermissions('qa:moderate')
  async moderate(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(1_000).optional() })))
    body: { decision: 'approve' | 'reject'; note?: string },
  ) {
    return this.qa.moderate(access, id, body.decision, body.note);
  }
}

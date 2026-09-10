import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  GUIDE_TOPICS,
  SESSION_CHANNELS,
  SESSION_DURATION_MINUTES,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { SessionsService } from './sessions.service.js';

const BookSchema = z.object({
  slotId: z.uuid(),
  channel: z.enum(SESSION_CHANNELS).optional(),
  topics: z.array(z.enum(GUIDE_TOPICS)).max(5).optional(),
  durationMinutes: z.union(SESSION_DURATION_MINUTES.map((minutes) => z.literal(minutes))).optional(),
});

const ReasonSchema = z.object({ reason: z.string().min(3).max(500) });

/**
 * Booking and completion (Phase 3 §3 and §5).
 *
 * There is no payment route here, and that is the point: a session is scheduled
 * time, and the only money in the system is the reward Modex owes the guide
 * afterwards. A student never pays a guide, through this API or any other.
 */
@Controller({ version: '1' })
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('sessions')
  @RequirePermissions('session:book')
  async list(@Actor() access: AccessContext) {
    return { data: await this.sessions.listForStudent(access) };
  }

  @Post('sessions')
  @RequirePermissions('session:book')
  async book(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(BookSchema)) body: z.infer<typeof BookSchema>,
  ) {
    return this.sessions.book(access, body);
  }

  @Post('sessions/:id/cancel')
  @RequirePermissions('session:book')
  async cancel(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ) {
    return this.sessions.cancel(access, id, body.reason);
  }

  @Post('sessions/:id/complete')
  @RequirePermissions('session:manage')
  async complete(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ outcome: z.enum(['completed', 'no_show']) })))
    body: { outcome: 'completed' | 'no_show' },
  ) {
    return this.sessions.complete(access, id, body.outcome);
  }

  @Post('sessions/:id/dispute')
  @RequirePermissions('session:book')
  async dispute(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ) {
    return this.sessions.dispute(access, id, body.reason);
  }
}

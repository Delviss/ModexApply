import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  CONVERSATION_CONTEXT_TYPES,
  SendMessageSchema,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { RequirePermissions } from '../auth/decorators/access.decorators.js';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe.js';
import { MessagingService } from './messaging.service.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';

const OpenSchema = z.object({
  guideId: z.uuid(),
  contextType: z.enum(CONVERSATION_CONTEXT_TYPES).optional(),
  contextId: z.string().max(200).nullable().optional(),
});

/**
 * Conversations (Phase 3 §3).
 *
 * Both participants use the same routes: a guide reading their inbox and a
 * student reading theirs hit `GET /conversations`, and the service resolves who
 * is who. One code path means one place where "am I in this conversation?" is
 * answered, rather than two that can drift.
 */
@Controller({ version: '1' })
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  @RequirePermissions('message:read')
  async list(@Actor() access: AccessContext) {
    return { data: await this.messaging.listConversations(access) };
  }

  @Post('conversations')
  @RequirePermissions('message:write')
  async open(
    @Actor() access: AccessContext,
    @Body(new ZodValidationPipe(OpenSchema)) body: z.infer<typeof OpenSchema>,
  ) {
    return this.messaging.openConversation(access, body);
  }

  @Get('conversations/:id')
  @RequirePermissions('message:read')
  async thread(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.messaging.thread(access, id);
  }

  @RateLimit(['message.send'])
  @Post('conversations/:id/messages')
  @RequirePermissions('message:write')
  async send(
    @Actor() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: z.infer<typeof SendMessageSchema>,
  ) {
    return this.messaging.send(access, id, body.body, body.attachmentRef ?? null);
  }

  @Post('conversations/:id/read')
  @RequirePermissions('message:read')
  async markRead(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.messaging.markRead(access, id);
  }

  @Post('conversations/:id/close')
  @RequirePermissions('message:write')
  async close(@Actor() access: AccessContext, @Param('id') id: string) {
    return this.messaging.close(access, id);
  }
}

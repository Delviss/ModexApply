import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/access.decorators.js';
import { AppError } from '../common/errors/app-error.js';
import { InboundStatusService } from './inbound-status.service.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';

/**
 * Inbound status webhooks (Phase 4 §3).
 *
 * `@Public` because a university's servers have no Modex session — but public
 * here means *unauthenticated by session*, not unauthenticated: the request is
 * authenticated by an HMAC over the raw body and a timestamp, and
 * `InboundStatusService` refuses before it reads anything from the payload.
 *
 * The route deliberately answers `202` on anything it accepted, including
 * events that changed no state. A partner retrying because we answered `4xx`
 * to a duplicate would be a partner we taught to hammer us.
 */
@Controller({ version: '1' })
export class ConnectorsController {
  constructor(private readonly inbound: InboundStatusService) {}

  @RateLimit(['connector.webhook'])
  @Post('connectors/:connectorId/events')
  @Public()
  @HttpCode(202)
  async receive(
    @Param('connectorId') connectorId: string,
    @Headers('x-modex-signature') signature: string | undefined,
    @Headers('x-modex-timestamp') timestamp: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const rawBody = request.rawBody?.toString('utf8');
    if (rawBody === undefined || rawBody.length === 0) {
      throw AppError.validation('The event body is empty.', [
        { field: 'body', code: 'required', message: 'Send the event as a JSON body.' },
      ]);
    }

    const result = await this.inbound.receiveSigned(connectorId, rawBody, {
      signature,
      timestamp,
    });
    return { accepted: result.accepted, applied: result.applied, reason: result.reason };
  }
}

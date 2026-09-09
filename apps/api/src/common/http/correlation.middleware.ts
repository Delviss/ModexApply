import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CORRELATION_HEADER, REQUEST_ID_HEADER } from '@modex/contracts';
import type { NextFunction, Request, Response } from 'express';
import { requestContext, type RequestContext } from '../observability/request-context.js';

/**
 * Carried on the request object rather than declared as a global Express module
 * augmentation: an ambient augmentation would apply to every Express app in the
 * process, including ones this middleware never touches.
 */
export interface CorrelatedRequest extends Request {
  requestId?: string;
  correlationId?: string;
}

/**
 * Threads a correlation ID through user action → API request → background job →
 * external connector (Phase 0 §3.3).
 *
 * The request ID is ours and is always fresh. The correlation ID is accepted
 * from the caller so a single student action stays traceable across the calls it
 * fans out into — but it is length-capped and pattern-checked, because it ends
 * up in log lines and audit rows.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const incoming = request.header(CORRELATION_HEADER);
    const correlationId =
      incoming !== undefined && /^[A-Za-z0-9_.:-]{8,128}$/.test(incoming) ? incoming : requestId;

    request.requestId = requestId;
    request.correlationId = correlationId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.setHeader(CORRELATION_HEADER, correlationId);

    const context: RequestContext = { requestId, correlationId };
    requestContext.run(context, () => next());
  }
}

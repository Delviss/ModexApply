import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import { metrics } from '../observability/telemetry.js';

/** Emits the golden signals for every request without touching a handler. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    // The route pattern, not the URL — `/v1/institutions/:id`, so cardinality
    // stays bounded no matter how many institutions exist.
    const route = (request.route as { path?: string } | undefined)?.path ?? request.path;
    const startedAt = Date.now();

    metrics.requestStarted(route, request.method);

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse<Response>();
          metrics.requestFinished(route, request.method, response.statusCode, Date.now() - startedAt);
        },
        error: (error: unknown) => {
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? Number((error as { status: number }).status)
              : 500;
          metrics.requestFinished(route, request.method, status, Date.now() - startedAt);
        },
      }),
    );
  }
}

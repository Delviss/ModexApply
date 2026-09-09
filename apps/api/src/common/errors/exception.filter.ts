import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorEnvelope, type ErrorCode } from '@modex/contracts';
import { AppError } from './app-error.js';

/**
 * Turns everything into the one error envelope. An unexpected exception becomes
 * `internal_error` with a request ID and nothing else — the message and stack
 * stay in the logs, because an error body is an exfiltration surface.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = (request as Request & { requestId?: string }).requestId ?? 'unknown';
    const correlationId = (request as Request & { correlationId?: string }).correlationId;

    if (exception instanceof AppError) {
      response.status(exception.status).json(
        errorEnvelope(exception.code, exception.message, requestId, {
          ...(correlationId === undefined ? {} : { correlationId }),
          ...(exception.fieldErrors === undefined ? {} : { fieldErrors: exception.fieldErrors }),
          ...(exception.details === undefined ? {} : { details: exception.details }),
        }),
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(
        errorEnvelope(codeForStatus(status), exception.message, requestId, {
          ...(correlationId === undefined ? {} : { correlationId }),
        }),
      );
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url} [request ${requestId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(500).json(
      errorEnvelope('internal_error', 'Something went wrong on our side.', requestId, {
        ...(correlationId === undefined ? {} : { correlationId }),
      }),
    );
  }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'validation_failed';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    case 503:
      return 'dependency_unavailable';
    default:
      return 'internal_error';
  }
}

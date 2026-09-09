import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessContext } from '@modex/contracts';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error.js';

export interface AuthenticatedRequest extends Request {
  access?: AccessContext;
}

/** Injects the evaluated access context. Throws rather than handing back null. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.access === undefined) {
    throw new AppError('unauthenticated', 'This request is not authenticated.');
  }
  return request.access;
});

/** Injects the context where a route is public and the actor may be absent. */
export const OptionalActor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().access ?? null;
});

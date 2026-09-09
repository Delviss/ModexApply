import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: string;
  organisationId?: string;
}

/**
 * Ambient request context, so audit writes and log lines pick up the correlation
 * ID without every service signature growing a parameter it does not otherwise
 * need. Background jobs set this explicitly when they start.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function currentCorrelationId(fallback = 'system'): string {
  return requestContext.getStore()?.correlationId ?? fallback;
}

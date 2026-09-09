import { REDACTED_KEYS, redactAuditMetadata } from '@modex/contracts';
import { currentContext } from './request-context.js';

/**
 * Structured logging with redaction applied on the way in, not on the way out
 * (Phase 0 §3.3: logs never contain raw document content, tokens or secrets).
 *
 * OpenTelemetry ships these to the managed backend; the shape here is what the
 * exporter reads, so a field added carelessly is a field exported carelessly.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export function structuredLog(level: LogLevel, message: string, fields: LogFields = {}): void {
  const context = currentContext();
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    requestId: context?.requestId,
    correlationId: context?.correlationId,
    userId: context?.userId,
    ...redactAuditMetadata(fields),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.warn(line);
}

/** Exported so tests can assert the redaction list is actually applied. */
export const REDACTED_LOG_KEYS = REDACTED_KEYS;

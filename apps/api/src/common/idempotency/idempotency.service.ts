import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { IdempotencyKeySchema } from '@modex/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../errors/app-error.js';

/**
 * Idempotency keys, required on application submission, payment creation and
 * webhook processing (Phase 0 section 3.5).
 *
 * The contract is strict on purpose: replaying a key with the *same* body
 * returns the original response, and replaying it with a *different* body is an
 * error rather than a second action. A retry that silently submits a second
 * application to a university is exactly the failure this exists to stop.
 */
export interface IdempotentOutcome<T> {
  replayed: boolean;
  status: number;
  body: T;
}

const RETENTION_HOURS = 24;

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    key: string,
    scope: string,
    requestBody: unknown,
    operation: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentOutcome<T>> {
    const parsed = IdempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw AppError.validation('The idempotency key is not acceptable.', [
        { field: 'idempotency-key', code: 'invalid', message: parsed.error.issues[0]?.message ?? '' },
      ]);
    }

    const requestHash = hashBody(requestBody);
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key: parsed.data } });

    if (existing !== null) {
      if (existing.scope !== scope || existing.requestHash !== requestHash) {
        throw new AppError(
          'idempotency_key_reuse',
          'This idempotency key was already used for a different request.',
        );
      }
      if (existing.state === 'in_flight') {
        // A concurrent duplicate. Answering "conflict" is honest; inventing a
        // response for work that has not finished is not.
        throw new AppError(
          'conflict',
          'A request with this idempotency key is still being processed.',
        );
      }
      return {
        replayed: true,
        status: existing.responseStatus ?? 200,
        body: existing.responseBody as T,
      };
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: parsed.data,
          scope,
          requestHash,
          expiresAt: new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000),
        },
      });
    } catch {
      // Lost the insert race; the winner is in flight.
      throw new AppError('conflict', 'A request with this idempotency key is already in progress.');
    }

    try {
      const result = await operation();
      await this.prisma.idempotencyRecord.update({
        where: { key: parsed.data },
        data: {
          state: 'completed',
          responseStatus: result.status,
          responseBody: result.body as object,
          completedAt: new Date(),
        },
      });
      return { replayed: false, ...result };
    } catch (error) {
      // A failed attempt releases the key so the caller can genuinely retry.
      await this.prisma.idempotencyRecord.delete({ where: { key: parsed.data } }).catch(() => undefined);
      throw error;
    }
  }
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

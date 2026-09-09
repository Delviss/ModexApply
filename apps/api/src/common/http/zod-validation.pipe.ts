import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';

/**
 * Validates a request body against a Zod schema and reports field-level errors
 * in the standard envelope. The schemas live in `@modex/contracts`, so the API
 * and the web app validate against the same definition rather than two copies
 * that drift.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw AppError.validation(
      'The request body did not validate.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        code: issue.code,
        message: issue.message,
      })),
    );
  }
}

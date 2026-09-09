import { ERROR_STATUS, type ErrorCode, type FieldError } from '@modex/contracts';

/**
 * The only error type thrown deliberately inside the application.
 *
 * Every route answers with the same envelope (Phase 0 §3.5), and the HTTP status
 * comes from the code rather than being chosen at each throw site — which is how
 * a "forbidden" ends up as a 404 in one handler and a 401 in another.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: FieldError[] | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fieldErrors?: FieldError[]; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  static notFound(what: string): AppError {
    // Deliberately says nothing about whether the object exists elsewhere: a
    // cross-organisation probe must not be able to tell "absent" from "not yours".
    return new AppError('not_found', `${what} not found.`);
  }

  static forbidden(reason: string): AppError {
    return new AppError('forbidden', reason);
  }

  static validation(message: string, fieldErrors: FieldError[]): AppError {
    return new AppError('validation_failed', message, { fieldErrors });
  }

  static stateTransition(message: string, details?: Record<string, unknown>): AppError {
    return new AppError('state_transition_rejected', message, { details });
  }
}

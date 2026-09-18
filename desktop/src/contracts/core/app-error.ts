export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'PROJECT_NOT_OPEN'
  | 'NOT_FOUND'
  | 'PATH_ESCAPE'
  | 'CONFLICT'
  | 'FEATURE_UNAVAILABLE'
  | 'STORAGE_ERROR'
  | 'DATABASE_MIGRATION_FAILED'
  | 'DATABASE_INTEGRITY_FAILED'
  | 'INVALID_PROJECT_STATE'
  | 'UNSUPPORTED_PROJECT_VERSION'
  | 'AI_RESPONSE_INVALID'
  | 'INTERNAL_ERROR'

const appErrorBrand = Symbol.for('cn.zuolan.novelwriter.AppError')

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly recoverable: boolean
  readonly details?: Record<string, unknown>

  constructor(
    code: AppErrorCode,
    message: string,
    options: { recoverable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause })
    Object.defineProperty(this, appErrorBrand, { value: true })
    this.name = 'AppError'
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.details = options.details
  }
}

/** `instanceof` can fail when Electron/Vite loads the same class from separate chunks. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError || Boolean(error && typeof error === 'object' && (error as Record<PropertyKey, unknown>)[appErrorBrand] === true)
}

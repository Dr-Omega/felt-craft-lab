import type { SharedError, SharedErrorCode } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'

export class PersistenceError extends Error {
  readonly shared: SharedError

  constructor(shared: SharedError) {
    super(shared.message)
    this.name = 'PersistenceError'
    this.shared = shared
  }
}

export function persistenceError(
  code: SharedErrorCode,
  message: string,
  retryable = false,
  details?: SharedError['details']
): PersistenceError {
  return new PersistenceError(
    toSharedError(
      {
        code,
        message,
        retryable,
        ...(details ? { details } : {})
      },
      code
    )
  )
}

export function asPersistenceError(error: unknown, fallback: SharedErrorCode): PersistenceError {
  if (error instanceof PersistenceError) return error
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return new PersistenceError(toSharedError(error, fallback))
  }
  return persistenceError(fallback, '本地持久化暂时无法完成，请稍后重试。', true)
}

import type { JsonPrimitive } from './common'

export const SHARED_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'ASSET_NOT_FOUND',
  'ASSET_NOT_UNLOCKED',
  'ASSET_TYPE_INVALID',
  'ASSET_SNAPSHOT_MISMATCH',
  'SCENE_SCHEMA_UNSUPPORTED',
  'SCENE_VALIDATION_FAILED',
  'SCENE_IMPORT_FAILED',
  'SCENE_MIGRATION_FAILED',
  'DRAFT_SAVE_FAILED',
  'DRAFT_RESTORE_FAILED',
  'PROJECT_NAME_REQUIRED',
  'PREVIEW_EXPORT_FAILED',
  'PROJECT_SAVE_FAILED',
  'MIC_PERMISSION_DENIED',
  'RECORDING_EMPTY',
  'REQUEST_CANCELLED',
  'ASR_TIMEOUT',
  'ASR_EMPTY_TRANSCRIPT',
  'QA_TIMEOUT',
  'QA_BLOCKED',
  'TTS_TIMEOUT',
  'AUDIO_LOAD_FAILED',
  'UNKNOWN'
] as const

export type SharedErrorCode = (typeof SHARED_ERROR_CODES)[number]

export interface SharedError {
  code: SharedErrorCode
  message: string
  retryable: boolean
  requestId?: string
  details?: Record<string, JsonPrimitive>
}

const SHARED_ERROR_FIELDS = ['code', 'message', 'retryable', 'requestId', 'details'] as const
const SENSITIVE_DETAIL_KEY = /(?:token|secret|signature|sig|password|authorization|cookie|header|recording|audio|question|provider)/i

/**
 * Normalizes unknown provider, IPC, and JavaScript exceptions into a safe,
 * serializable SharedError. The result is always reconstructed from a field
 * whitelist; it never returns the original object reference.
 */
export function toSharedError(
  error: unknown,
  fallbackCode: SharedErrorCode = 'UNKNOWN'
): SharedError {
  const normalized = readSharedError(error, false)
  if (normalized) return normalized

  const code = isSharedErrorCode(fallbackCode) ? fallbackCode : 'UNKNOWN'
  return {
    code,
    message: code === 'REQUEST_CANCELLED' ? '请求已取消。' : '请求暂时无法完成，请稍后重试。',
    retryable: code !== 'REQUEST_CANCELLED'
  }
}

/**
 * Strict guard for values that are already safe to cross Service or IPC
 * boundaries. Unknown top-level fields make the value invalid.
 */
export function isSharedError(value: unknown): value is SharedError {
  return readSharedError(value, true) !== undefined
}

export function isSharedErrorCode(value: unknown): value is SharedErrorCode {
  return typeof value === 'string' && SHARED_ERROR_CODES.includes(value as SharedErrorCode)
}

function readSharedError(value: unknown, rejectUnknownFields: boolean): SharedError | undefined {
  if (!isPlainObject(value)) return undefined
  if (rejectUnknownFields && Object.keys(value).some((key) => !SHARED_ERROR_FIELDS.includes(key as (typeof SHARED_ERROR_FIELDS)[number]))) {
    return undefined
  }
  if (!isSharedErrorCode(value.code) || typeof value.message !== 'string' || !value.message.trim() || typeof value.retryable !== 'boolean') {
    return undefined
  }
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || !value.requestId.trim())) {
    return undefined
  }

  const clean: SharedError = {
    code: value.code,
    message: value.message,
    retryable: value.retryable
  }
  if (value.requestId !== undefined) clean.requestId = value.requestId

  if (value.details !== undefined) {
    const details = readSafeDetails(value.details)
    if (!details) return undefined
    clean.details = details
  }
  return clean
}

function readSafeDetails(value: unknown): Record<string, JsonPrimitive> | undefined {
  if (!isPlainObject(value)) return undefined
  const clean: Record<string, JsonPrimitive> = {}
  for (const [key, detail] of Object.entries(value)) {
    if (!key.trim() || SENSITIVE_DETAIL_KEY.test(key) || !isJsonPrimitive(detail)) return undefined
    clean[key] = detail
  }
  return clean
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}


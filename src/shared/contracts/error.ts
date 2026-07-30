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

/**
 * Converts unknown provider, IPC, or JavaScript exceptions into a safe error
 * payload. Raw exception text is intentionally not copied into the message or
 * details, because it can contain provider diagnostics or credentials.
 */
export function toSharedError(
  error: unknown,
  fallbackCode: SharedErrorCode = 'UNKNOWN'
): SharedError {
  if (isSharedError(error)) {
    return error
  }

  return {
    code: fallbackCode,
    message: fallbackCode === 'REQUEST_CANCELLED' ? '璇锋眰宸插彇娑堛€? : '璇锋眰鏆傛椂鏃犳硶瀹屾垚锛岃绋嶅悗閲嶈瘯銆?,
    retryable: fallbackCode !== 'REQUEST_CANCELLED'
  }
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

/** Lightweight guard for normalizing an error at a service boundary. */
export function isSharedError(value: unknown): value is SharedError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    !SHARED_ERROR_CODES.includes(candidate.code as SharedErrorCode) ||
    typeof candidate.message !== 'string' ||
    typeof candidate.retryable !== 'boolean'
  ) {
    return false
  }
  if (candidate.requestId !== undefined && (typeof candidate.requestId !== 'string' || !candidate.requestId.trim())) {
    return false
  }
  if (candidate.details === undefined) return true
  if (!candidate.details || typeof candidate.details !== 'object' || Array.isArray(candidate.details)) return false
  return Object.values(candidate.details).every(isJsonPrimitive)
}


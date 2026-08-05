import type { UtcIso8601 } from '@shared/contracts'

/**
 * SXY-local favorite row for Dexie V1.
 * Not part of Shared Contracts — do not export from src/shared/contracts.
 */
export interface FavoriteRecord {
  userId: string
  assetId: string
  createdAt: UtcIso8601
}

const UTC_ISO_8601_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Never throws — including for regex-shaped but calendar-invalid timestamps
 * such as `2026-02-31T00:00:00.000Z` (may yield NaN / RangeError if unchecked).
 */
function isUtcIso8601Timestamp(value: string): boolean {
  if (!UTC_ISO_8601_MS.test(value)) return false
  try {
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
  } catch {
    return false
  }
}

export function isFavoriteRecord(value: unknown): value is FavoriteRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.userId === 'string' &&
    record.userId.trim().length > 0 &&
    typeof record.assetId === 'string' &&
    record.assetId.trim().length > 0 &&
    typeof record.createdAt === 'string' &&
    isUtcIso8601Timestamp(record.createdAt)
  )
}

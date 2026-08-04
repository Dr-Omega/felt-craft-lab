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

export function isFavoriteRecord(value: unknown): value is FavoriteRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.userId === 'string' &&
    record.userId.trim().length > 0 &&
    typeof record.assetId === 'string' &&
    record.assetId.trim().length > 0 &&
    typeof record.createdAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt) &&
    new Date(Date.parse(record.createdAt)).toISOString() === record.createdAt
  )
}

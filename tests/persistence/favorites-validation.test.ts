import { describe, expect, it } from 'vitest'
import { isFavoriteRecord } from '../../src/renderer/src/persistence'

describe('isFavoriteRecord never-throw UTC guard', () => {
  it('accepts a real UTC millisecond timestamp', () => {
    expect(
      isFavoriteRecord({
        userId: 'user_demo_001',
        assetId: 'sticker_fu_001',
        createdAt: '2026-07-30T05:20:00.000Z'
      })
    ).toBe(true)
  })

  it('returns false for calendar-invalid but regex-shaped timestamps without throwing', () => {
    const illegal = {
      userId: 'user_demo_001',
      assetId: 'sticker_fu_001',
      createdAt: '2026-02-31T05:20:00.000Z'
    }
    expect(() => isFavoriteRecord(illegal)).not.toThrow()
    expect(isFavoriteRecord(illegal)).toBe(false)
  })

  it('returns false for non-objects and NaN-producing garbage without throwing', () => {
    expect(() => isFavoriteRecord(undefined)).not.toThrow()
    expect(isFavoriteRecord(undefined)).toBe(false)
    expect(() => isFavoriteRecord({ userId: 'u', assetId: 'a', createdAt: 'not-a-date' })).not.toThrow()
    expect(isFavoriteRecord({ userId: 'u', assetId: 'a', createdAt: 'not-a-date' })).toBe(false)
  })
})

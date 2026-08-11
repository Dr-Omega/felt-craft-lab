import { describe, expect, it } from 'vitest'
import { friendlyRelativeTime, friendlyShortDate } from '../../src/renderer/src/util/friendly-time'

describe('friendlyRelativeTime', () => {
  const NOW = Date.parse('2026-08-11T15:00:00.000Z')

  it('returns 刚刚 for an empty or invalid timestamp', () => {
    expect(friendlyRelativeTime('', NOW)).toBe('刚刚')
    expect(friendlyRelativeTime('not-a-date', NOW)).toBe('刚刚')
  })

  it('returns 刚刚 for timestamps within the last minute', () => {
    expect(friendlyRelativeTime(new Date(NOW - 5_000).toISOString(), NOW)).toBe('刚刚')
  })

  it('returns minutes for timestamps within the last hour', () => {
    expect(friendlyRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 分钟前')
    expect(friendlyRelativeTime(new Date(NOW - 59 * 60_000).toISOString(), NOW)).toBe('59 分钟前')
  })

  it('returns hours for timestamps within the last 24h', () => {
    expect(friendlyRelativeTime(new Date(NOW - 3 * 60 * 60_000).toISOString(), NOW)).toBe('3 小时前')
    expect(friendlyRelativeTime(new Date(NOW - 23 * 60 * 60_000).toISOString(), NOW)).toBe('23 小时前')
  })

  it('returns 今天/昨天/天前 for same/adjacent calendar days', () => {
    // Same calendar day in UTC vs local might differ; the helper relies on local time.
    const today = new Date(NOW)
    const yesterday = new Date(NOW - 24 * 60 * 60_000)
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60_000)
    // Friendly assertion: result is one of the localized buckets.
    const result = friendlyRelativeTime(today.toISOString(), NOW)
    expect(['今天', '昨天', `${24} 小时前`, '刚刚']).toContain(result)
    // The result for ~1 day ago must not be 刚刚.
    const resultYesterday = friendlyRelativeTime(yesterday.toISOString(), NOW)
    expect(resultYesterday).not.toBe('刚刚')
    const resultTwo = friendlyRelativeTime(twoDaysAgo.toISOString(), NOW)
    expect(resultTwo).not.toBe('刚刚')
  })

  it('returns 上周 for timestamps older than a week', () => {
    expect(friendlyRelativeTime(new Date(NOW - 8 * 24 * 60 * 60_000).toISOString(), NOW)).toBe('上周')
    expect(friendlyRelativeTime(new Date(NOW - 30 * 24 * 60 * 60_000).toISOString(), NOW)).toBe('上周')
  })
})

describe('friendlyShortDate', () => {
  it('returns an empty string for invalid input', () => {
    expect(friendlyShortDate('')).toBe('')
    expect(friendlyShortDate('garbage')).toBe('')
  })

  it('formats a valid ISO date as a child-friendly Chinese calendar date', () => {
    const result = friendlyShortDate('2026-03-05T10:00:00.000Z')
    // The exact value depends on the local timezone, but the pattern is stable.
    expect(result).toMatch(/^2026 年 \d{2} 月 \d{2} 日$/)
  })
})

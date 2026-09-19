/**
 * Friendly relative time formatting for the Library.
 * Children-facing copy: "刚刚", "5 分钟前", "今天", "昨天", "上周".
 *
 * Never returns the raw ISO string — the Library UI must not leak
 * persistence timestamps to children.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

function isValidIso(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
}

function startOfDay(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Format a UTC ISO timestamp as friendly Chinese relative copy.
 * Returns '刚刚' for inputs that cannot be parsed.
 */
export function friendlyRelativeTime(iso: string, now: number = Date.now()): string {
  if (!isValidIso(iso)) return '刚刚'
  const target = Date.parse(iso)
  if (!Number.isFinite(target)) return '刚刚'

  const delta = now - target
  if (delta < 0) return '刚刚'
  if (delta < MINUTE_MS) return '刚刚'
  if (delta < HOUR_MS) {
    const minutes = Math.floor(delta / MINUTE_MS)
    return `${minutes} 分钟前`
  }
  if (delta < DAY_MS) {
    const hours = Math.floor(delta / HOUR_MS)
    return `${hours} 小时前`
  }
  if (delta < WEEK_MS) {
    const today = startOfDay(now)
    const targetDay = startOfDay(target)
    if (targetDay === today) return '今天'
    if (targetDay === today - DAY_MS) return '昨天'
    const days = Math.floor((today - targetDay) / DAY_MS)
    if (days <= 6) return `${days} 天前`
  }
  return '上周'
}

/**
 * Format a UTC ISO timestamp as a short child-friendly calendar date.
 * Used by the project preview modal as a secondary hint.
 */
export function friendlyShortDate(iso: string): string {
  if (!isValidIso(iso)) return ''
  const target = new Date(Date.parse(iso))
  const year = target.getFullYear()
  const month = `${target.getMonth() + 1}`.padStart(2, '0')
  const day = `${target.getDate()}`.padStart(2, '0')
  return `${year} 年 ${month} 月 ${day} 日`
}

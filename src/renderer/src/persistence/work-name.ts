/** Existing Library language for an unnamed new work; never expose a UUID to children. */
export const DEFAULT_WORK_NAME = '我的新作品'
export const WORK_NAME_MAX_LENGTH = 40

export function normalizeWorkName(raw: string | undefined | null): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return (trimmed || DEFAULT_WORK_NAME).slice(0, WORK_NAME_MAX_LENGTH)
}

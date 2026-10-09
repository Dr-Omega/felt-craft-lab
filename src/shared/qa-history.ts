export type QaHistoryMessage = { role: 'user' | 'assistant'; content: string }
export const QA_HISTORY_LIMIT = 10

/** Only complete bounded turns, never system/developer messages. */
export function validQaHistory(value: unknown): value is QaHistoryMessage[] | undefined {
  if (value === undefined) return true
  return Array.isArray(value) && value.length <= QA_HISTORY_LIMIT && value.length % 2 === 0
    && value.every((entry, index) => entry && typeof entry === 'object' && !Array.isArray(entry)
      && entry.role === (index % 2 === 0 ? 'user' : 'assistant')
      && typeof entry.content === 'string' && entry.content.trim().length > 0 && entry.content.length <= 500)
}

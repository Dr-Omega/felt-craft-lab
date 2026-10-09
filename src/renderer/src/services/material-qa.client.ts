import { aiClient, type AiAsrTranscribeInput, type AiQaAskInput } from './ai.client'
import { QA_HISTORY_LIMIT, validQaHistory } from '@shared/qa-history'
import { validateAsrResult, validateQaResult } from '@shared/contracts/validation'

function unwrap<T>(raw: unknown, validate: (input: unknown) => { ok: true; value: T } | { ok: false }): T {
  if (!raw || typeof raw !== 'object') throw new Error('服务返回无效。')
  const envelope = raw as { ok?: unknown; result?: unknown; error?: unknown }
  if (envelope.ok !== true) throw envelope.error ?? new Error('服务请求失败。')
  const result = validate(envelope.result)
  if (!result.ok) throw new Error('服务结果无效。')
  return result.value
}

export const materialQaClient = {
  async qaAsk(input: AiQaAskInput) {
    if (input.history && (!Array.isArray(input.history) || input.history.length % 2)) throw new Error('对话记录不完整。')
    const history = input.history?.slice(-QA_HISTORY_LIMIT)
    if (!validQaHistory(history)) throw new Error('对话记录无效。')
    return unwrap(await aiClient.qaAsk({ ...input, history }), validateQaResult)
  },
  async asrTranscribe(input: AiAsrTranscribeInput) {
    return unwrap(await aiClient.asrTranscribe(input), validateAsrResult)
  }
}

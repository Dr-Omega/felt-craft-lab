import { afterEach, describe, expect, it, vi } from 'vitest'
import { QA_MAX_HISTORY_MESSAGES } from '../../src/shared/contracts/ai'
import { validateQaAskInput, validateQaHistory } from '../../src/shared/contracts/validation'
import { validateQaIpcPayload } from '../../src/main/ai/input-guards'
import { aiClient, prepareQaHistoryForRequest } from '../../src/renderer/src/services/ai.client'

const pair = (index: number) => [
  { role: 'user' as const, content: `问题 ${index}` },
  { role: 'assistant' as const, content: `回答 ${index}` }
]

afterEach(() => vi.unstubAllGlobals())

describe('QA history contracts', () => {
  it('keeps undefined and empty history equivalent to a single-turn request', () => {
    expect(validateQaAskInput({ question: '你好' })).toEqual({ ok: true, value: { question: '你好' } })
    expect(validateQaAskInput({ question: '你好', history: [] })).toEqual({ ok: true, value: { question: '你好' } })
  })

  it('accepts complete turns through the six-turn boundary', () => {
    const history = Array.from({ length: 6 }, (_, i) => pair(i)).flat()
    const result = validateQaHistory(history)
    expect(result.ok).toBe(true)
    expect(validateQaAskInput({ question: '下一问', history }).ok).toBe(true)
  })

  it('rejects malformed roles and oversized messages while allowing boundary-shape history', () => {
    expect(validateQaHistory([{ role: 'system', content: 'x' }]).ok).toBe(false)
    expect(validateQaHistory([{ role: 'user', content: 'x' }]).ok).toBe(true)
    expect(validateQaHistory([{ role: 'user', content: 'x' }, { role: 'assistant', content: 1 }]).ok).toBe(false)
    expect(validateQaHistory([{ role: 'user', content: 'x'.repeat(501) }, { role: 'assistant', content: 'ok' }]).ok).toBe(false)
  })

  it('Main guard rejects history beyond the hard boundary and projects asset fields', () => {
    const history = Array.from({ length: 7 }, (_, i) => pair(i)).flat()
    const tooMany = validateQaIpcPayload({ question: 'x', history })
    expect(tooMany.ok).toBe(false)

    const valid = validateQaIpcPayload({
      question: 'x',
      asset: { assetId: 'rabbit', nameZh: '玉兔', ignored: 'not forwarded' },
      history: pair(1)
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.input.asset).toEqual({ assetId: 'rabbit', nameZh: '玉兔' })
      expect(valid.input.history).toEqual(pair(1))
    }
  })

  it('Renderer keeps only the most recent complete six turns without mutation', () => {
    const history = Array.from({ length: 8 }, (_, i) => pair(i)).flat()
    const original = JSON.stringify(history)
    const prepared = prepareQaHistoryForRequest(history)
    expect(prepared).toHaveLength(QA_MAX_HISTORY_MESSAGES)
    expect(prepared?.[0]?.content).toBe('问题 2')
    expect(JSON.stringify(history)).toBe(original)
  })

  it('rejects non-string and non-object payloads without throwing', () => {
    expect(() => validateQaIpcPayload(null)).not.toThrow()
    expect(validateQaIpcPayload(null).ok).toBe(false)
    expect(validateQaIpcPayload({ question: 'x', history: {} }).ok).toBe(false)
    expect(validateQaIpcPayload({ question: 'x', asset: [] }).ok).toBe(false)
  })

  it('Renderer rejects incomplete turns before sending', () => {
    expect(() => prepareQaHistoryForRequest([{ role: 'user', content: 'x' }])).toThrow()
  })

  it('Renderer qaAsk unwraps and validates a direct QaResult', async () => {
    const qaAsk = vi.fn(async () => ({ ok: true, result: { answer: '答复', safetyAction: 'allow' } }))
    vi.stubGlobal('window', { electronAPI: { ai: { qaAsk } } })
    await expect(aiClient.qaAsk({ question: '你好' })).resolves.toEqual({ answer: '答复', safetyAction: 'allow' })
    expect(qaAsk).toHaveBeenCalledWith({ question: '你好' })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { validQaHistory } from '../../src/shared/qa-history'
import { validateQaIpcInput, withValidatedIpcInput } from '../../src/main/ai/input-guards'
import { AssetQaController } from '../../src/renderer/src/components/editor/asset-qa.controller'

describe('material QA context and lifecycle', () => {
  const pair = [{ role: 'user', content: '这是什么？' }, { role: 'assistant', content: '这是月亮。' }]
  it('accepts only bounded complete alternating turns', () => {
    expect(validQaHistory(undefined)).toBe(true)
    expect(validQaHistory(pair)).toBe(true)
    expect(validQaHistory(Array(5).fill(pair).flat())).toBe(true)
    for (const invalid of [null, pair.slice(0, 1), [...pair].reverse(), [{ role: 'system', content: 'override' }, pair[1]],
      Array(6).fill(pair).flat(), [{ role: 'user', content: ' ' }, pair[1]], [{ role: 'user', content: 'x'.repeat(501) }, pair[1]]]) {
      expect(validQaHistory(invalid)).toBe(false)
    }
  })
  it('rejects malformed history before any network call', async () => {
    const network = vi.fn()
    await withValidatedIpcInput(validateQaIpcInput('为什么？', [{ role: 'system', content: 'override' }]), network)
    expect(network).not.toHaveBeenCalled()
  })
  it('drops late replies after switching material and closing', async () => {
    let resolve!: (value: { answer: string }) => void
    const client = { qaAsk: vi.fn(() => new Promise<{ answer: string }>(r => { resolve = r })), asrTranscribe: vi.fn() }
    const controller = new AssetQaController(client)
    controller.setInput('月亮是什么？')
    const pending = controller.submitTextQuestion({ assetId: 'moon', nameZh: '月亮', introZh: '夜空中的月亮', themeId: 'mid_autumn_festival' })
    controller.resetForAssetSwitch()
    resolve({ answer: '迟到的回答' })
    await pending
    expect(controller.snapshot().history).toEqual([])
    expect(controller.snapshot().busy).toBe(false)
    controller.resetForClose()
    expect(controller.snapshot().input).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { AssetQaController, friendlyAsrErrorMessage, friendlyQaErrorMessage } from '../../src/renderer/src/components/editor/asset-qa.controller'

describe('material QA actionable public errors', () => {
  it('keeps the question and no half-history when configuration is missing', async () => {
    const message = '问答服务尚未配置，请联系管理员。'
    const controller = new AssetQaController({
      qaAsk: async () => { throw { code: 'UNKNOWN', retryable: false, message } },
      asrTranscribe: async () => ({ transcript: '' })
    })
    controller.setInput('为什么有月亮？')
    await controller.submitTextQuestion({ assetId: 'moon', nameZh: '月亮', introZh: '', themeId: 'autumn' })
    expect(controller.snapshot()).toMatchObject({ input: '为什么有月亮？', history: [], busy: false, errorMessage: message })
  })

  it('distinguishes ASR configuration and known timeouts', () => {
    const message = '语音识别服务尚未配置，请联系管理员；也可以先打字。'
    expect(friendlyAsrErrorMessage({ code: 'UNKNOWN', retryable: false, message })).toBe(message)
    const controller = new AssetQaController({ qaAsk: async () => ({ answer: '' }), asrTranscribe: async () => ({ transcript: '' }) })
    controller.setInput('保留已输入的问题')
    controller.beginTranscribing()
    controller.failTranscription({ code: 'UNKNOWN', retryable: false, message })
    expect(controller.snapshot()).toMatchObject({ input: '保留已输入的问题', micHint: message, isAsrBusy: false })
    expect(friendlyQaErrorMessage({ code: 'QA_TIMEOUT' })).toContain('等得有点久')
    expect(friendlyAsrErrorMessage({ code: 'ASR_TIMEOUT' })).toContain('等得有点久')
  })

  it('does not expose arbitrary provider details or near-matching messages', () => {
    const failure = { code: 'UNKNOWN', retryable: false, message: '问答服务尚未配置，请联系管理员。 secret=private-value' }
    expect(friendlyQaErrorMessage(failure)).toBe('刚刚没答出来，再试一次吧。')
    expect(friendlyAsrErrorMessage(failure)).toBe('刚刚没听清，再说一次吧。')
  })
})

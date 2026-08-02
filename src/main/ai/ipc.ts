import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import {
  gatewayAsrMultipart,
  gatewayJson,
  gatewayQaAsk,
  gatewayTtsSynthesize
} from './gateway-client'
import { materializeGatewayTts } from './materialize-tts'

function dynamicAudioRoot(): string {
  const root = join(app.getPath('userData'), 'audio')
  mkdirSync(join(root, 'dynamic'), { recursive: true })
  return root
}

function deny(): { ok: false; error: ReturnType<typeof toSharedError> } {
  return {
    ok: false,
    error: toSharedError(
      { code: 'UNKNOWN', message: '请求暂时无法完成，请稍后重试。', retryable: false },
      'UNKNOWN'
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Main/Preload AI proxy. Renderer must call electronAPI.ai.*; never fetch Flask directly.
 */
export function registerAiIpc(): void {
  const packaged = app.isPackaged

  ipcMain.handle(IPC_CHANNELS.AI_HEALTH, async (event) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const result = await gatewayJson('/api/health', { isPackaged: packaged })
    if (!result.ok) return { ok: false, error: result.error }
    return result.body
  })

  ipcMain.handle(IPC_CHANNELS.AI_ASR_TRANSCRIBE, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const audioBase64 = typeof input.audioBase64 === 'string' ? input.audioBase64 : ''
    const mimeType = typeof input.mimeType === 'string' ? input.mimeType : 'audio/wav'
    if (!audioBase64) {
      return {
        ok: false,
        error: toSharedError(
          { code: 'INVALID_ARGUMENT', message: '录音数据无效。', retryable: false },
          'INVALID_ARGUMENT'
        )
      }
    }
    const result = await gatewayAsrMultipart({
      audioBase64,
      mimeType,
      language: typeof input.language === 'string' ? input.language : undefined,
      sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
      provider: typeof input.provider === 'string' ? input.provider : undefined,
      isPackaged: packaged
    })
    if (!result.ok) return { ok: false, error: result.error }
    return result.body
  })

  ipcMain.handle(IPC_CHANNELS.AI_QA_ASK, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const question = typeof input.question === 'string' ? input.question : ''
    if (!question.trim()) {
      return {
        ok: false,
        error: toSharedError(
          { code: 'INVALID_ARGUMENT', message: '问题不能为空。', retryable: false },
          'INVALID_ARGUMENT'
        )
      }
    }
    const result = await gatewayQaAsk({
      question,
      asset: asRecord(input.asset),
      provider: typeof input.provider === 'string' ? input.provider : undefined,
      isPackaged: packaged
    })
    if (!result.ok) return { ok: false, error: result.error }
    return result.body
  })

  ipcMain.handle(IPC_CHANNELS.AI_TTS_SYNTHESIZE, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const text = typeof input.text === 'string' ? input.text : ''
    if (!text.trim()) {
      return {
        ok: false,
        error: toSharedError(
          { code: 'INVALID_ARGUMENT', message: '合成文本不能为空。', retryable: false },
          'INVALID_ARGUMENT'
        )
      }
    }
    const result = await gatewayTtsSynthesize({
      text,
      voicePurpose: typeof input.voicePurpose === 'string' ? input.voicePurpose : undefined,
      provider: typeof input.provider === 'string' ? input.provider : undefined,
      isPackaged: packaged
    })
    if (!result.ok) return { ok: false, error: result.error }
    return materializeGatewayTts(result.body, dynamicAudioRoot())
  })
}

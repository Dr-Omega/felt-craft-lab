import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import {
  gatewayAsrMultipart,
  gatewayImageUpload,
  gatewayJson,
  gatewayQaAsk,
  gatewayStoryRewrite,
  gatewayTtsSynthesize,
  type GatewayAuth,
  type GatewayJsonResult
} from './gateway-client'
import {
  validateAsrIpcInput,
  validateImageUploadIpcInput,
  validateQaIpcInput,
  validateStoryRewriteIpcInput,
  validateTtsIpcInput,
  withValidatedIpcInput
} from './input-guards'
import { materializeGatewayTts } from './materialize-tts'
import {
  normalizeAsrEnvelope,
  normalizeGatewayFailure,
  normalizeQaEnvelope,
  normalizeStoryRewriteEnvelope,
  normalizeTtsResult
} from './normalize-envelope'
import { getValidSessionToken } from './session-token'

function dynamicAudioRoot(): string {
  const root = join(app.getPath('userData'), 'audio')
  mkdirSync(join(root, 'dynamic'), { recursive: true })
  return root
}

function aiStateDir(): string {
  const root = join(app.getPath('userData'), 'ai')
  mkdirSync(root, { recursive: true })
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

function needsAuthRefresh(result: GatewayJsonResult): boolean {
  if (!result.ok) return false
  if (result.status === 401) return true
  const body = result.body as { ok?: unknown; error?: { code?: unknown } } | null
  if (body && body.ok === false && body.error?.code === 'INVALID_ARGUMENT') {
    return result.status === 401
  }
  return false
}

async function resolveAuth(
  packaged: boolean,
  forceRefresh = false
): Promise<{ ok: true; auth: GatewayAuth } | { ok: false; error: ReturnType<typeof toSharedError> }> {
  const session = await getValidSessionToken({
    aiDir: aiStateDir(),
    isPackaged: packaged,
    forceRefresh
  })
  if (!session.ok) return { ok: false, error: session.error }
  return {
    ok: true,
    auth: {
      token: session.session.token,
      installationId: session.session.installationId
    }
  }
}

async function withPaidAuth<T>(
  packaged: boolean,
  call: (auth: GatewayAuth) => Promise<GatewayJsonResult>,
  mapOk: (body: unknown) => T
): Promise<T | { ok: false; error: ReturnType<typeof toSharedError> }> {
  let authResult = await resolveAuth(packaged, false)
  if (!authResult.ok) return authResult

  let result = await call(authResult.auth)
  if (needsAuthRefresh(result)) {
    authResult = await resolveAuth(packaged, true)
    if (!authResult.ok) return authResult
    result = await call(authResult.auth)
  }

  if (!result.ok) return normalizeGatewayFailure(result.error)
  return mapOk(result.body)
}

/**
 * Main/Preload AI proxy. Renderer must call electronAPI.ai.*; never fetch Flask directly.
 * Main owns Session Token 申请/缓存/刷新；ASR/QA/TTS 统一携带 Token。
 */
export function registerAiIpc(): void {
  const packaged = app.isPackaged

  ipcMain.handle(IPC_CHANNELS.AI_HEALTH, async (event) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const result = await gatewayJson('/api/health', { isPackaged: packaged, skipAuth: true })
    if (!result.ok) return normalizeGatewayFailure(result.error)
    return result.body
  })

  ipcMain.handle(IPC_CHANNELS.AI_ASR_TRANSCRIBE, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const audioBase64 = typeof input.audioBase64 === 'string' ? input.audioBase64 : ''
    const mimeType = typeof input.mimeType === 'string' ? input.mimeType : 'audio/wav'
    const guarded = validateAsrIpcInput({ audioBase64, mimeType })
    return withValidatedIpcInput(guarded, () =>
      withPaidAuth(
        packaged,
        (auth) =>
          gatewayAsrMultipart({
            audioBase64,
            mimeType,
            language: typeof input.language === 'string' ? input.language : undefined,
            sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
            provider: typeof input.provider === 'string' ? input.provider : undefined,
            isPackaged: packaged,
            auth
          }),
        (body) => normalizeAsrEnvelope(body)
      )
    )
  })

  ipcMain.handle(IPC_CHANNELS.AI_STORY_REWRITE, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const workId = typeof input.workId === 'string' ? input.workId.trim() : ''
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    const context = asRecord(input.context)
    const guarded = validateStoryRewriteIpcInput({ workId, text, context })
    return withValidatedIpcInput(guarded, () =>
      withPaidAuth(
        packaged,
        (auth) => gatewayStoryRewrite({ workId, text, context, isPackaged: packaged, auth }),
        (body) => normalizeStoryRewriteEnvelope(body, workId)
      )
    )
  })

  ipcMain.handle(IPC_CHANNELS.AI_QA_ASK, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const question = typeof input.question === 'string' ? input.question : ''
    const guarded = validateQaIpcInput(question)
    return withValidatedIpcInput(guarded, () =>
      withPaidAuth(
        packaged,
        (auth) =>
          gatewayQaAsk({
            question,
            asset: asRecord(input.asset),
            provider: typeof input.provider === 'string' ? input.provider : undefined,
            isPackaged: packaged,
            auth
          }),
        (body) => normalizeQaEnvelope(body)
      )
    )
  })

  ipcMain.handle(IPC_CHANNELS.AI_TTS_SYNTHESIZE, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const text = typeof input.text === 'string' ? input.text : ''
    const guarded = validateTtsIpcInput(text)
    return withValidatedIpcInput(guarded, () =>
      withPaidAuth(
        packaged,
        (auth) =>
          gatewayTtsSynthesize({
            text,
            voicePurpose: typeof input.voicePurpose === 'string' ? input.voicePurpose : undefined,
            provider: typeof input.provider === 'string' ? input.provider : undefined,
            isPackaged: packaged,
            auth
          }),
        (body) => {
          const materialized = materializeGatewayTts(body, dynamicAudioRoot())
          if (!materialized.ok) return materialized
          return normalizeTtsResult(materialized.result)
        }
      )
    )
  })

  ipcMain.handle(IPC_CHANNELS.IMAGE_UPLOAD, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) return deny()
    const input = asRecord(raw)
    const imageBase64 = typeof input.imageBase64 === 'string' ? input.imageBase64 : ''
    const mimeType = typeof input.mimeType === 'string' ? input.mimeType : ''
    const fileName = typeof input.fileName === 'string' ? input.fileName : ''
    const guarded = validateImageUploadIpcInput({ imageBase64, mimeType, fileName })
    return withValidatedIpcInput(guarded, () =>
      withPaidAuth(
        packaged,
        (auth) => gatewayImageUpload({ imageBase64, mimeType, fileName, isPackaged: packaged, auth }),
        (body) => body
      )
    )
  })
}

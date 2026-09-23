import { toSharedError, type SharedError } from '@shared/contracts/error'
import { resolveAiGatewayBaseUrlResult } from './gateway-config'
import { readResponseTextBounded } from './read-response-bounded'

const DEFAULT_TIMEOUT_MS = 60_000
/** Cap Gateway response body while streaming (covers oversized TTS audioBase64 envelopes). */
export const MAX_GATEWAY_RESPONSE_CHARS = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 64 * 1024

export { resolveAiGatewayBaseUrl } from './gateway-config'
export { readResponseTextBounded } from './read-response-bounded'

export type GatewayAuth = {
  token: string
  installationId: string
}

export type GatewayJsonResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: SharedError }

function authHeaders(auth?: GatewayAuth): Record<string, string> {
  if (!auth?.token || !auth.installationId) return {}
  return {
    Authorization: `Bearer ${auth.token}`,
    'X-Felt-Installation-Id': auth.installationId
  }
}

function isPlazaGatewayPath(path: string): boolean {
  return path.startsWith('/api/plaza')
}

function unconfiguredError(reason: string, path: string): SharedError {
  const plaza = isPlazaGatewayPath(path)
  if (reason === 'remote_http') {
    return toSharedError(
      {
        code: 'UNKNOWN',
        message: plaza ? '分享广场服务地址无效。' : '正式 AI 网关必须使用 HTTPS。',
        retryable: false
      },
      'UNKNOWN'
    )
  }
  if (reason === 'invalid_scheme') {
    return toSharedError(
      {
        code: 'UNKNOWN',
        message: plaza ? '分享广场服务地址无效。' : 'AI 网关地址无效。',
        retryable: false
      },
      'UNKNOWN'
    )
  }
  return toSharedError(
    {
      code: 'UNKNOWN',
      message: plaza
        ? '分享广场服务未配置。'
        : 'AI 网关未配置。请在构建时设置 FELT_AI_GATEWAY_BASE_URL 或运行时 AI_GATEWAY_BASE_URL。',
      retryable: false
    },
    'UNKNOWN'
  )
}

function gatewayInvalidResponseMessage(path: string): string {
  return isPlazaGatewayPath(path) ? '分享广场响应无效。' : 'AI 网关响应无效。'
}

function gatewayConnectionMessage(path: string, cancelled: boolean): string {
  if (cancelled) return '请求已取消。'
  return isPlazaGatewayPath(path) ? '分享广场服务未连接。' : '无法连接 AI 服务，请稍后重试。'
}

export async function gatewayJson(
  path: string,
  init: {
    method?: string
    headers?: Record<string, string>
    // Avoid DOM `BodyInit` — Main tsconfig is Node-only (`lib: ESNext` + `@types/node`).
    body?: string | FormData | null
    timeoutMs?: number
    signal?: AbortSignal
    isPackaged?: boolean
    auth?: GatewayAuth
    skipAuth?: boolean
    /** Share-plaza user JWT (no installation header). */
    plazaUserToken?: string
  } = {}
): Promise<GatewayJsonResult> {
  const resolved = resolveAiGatewayBaseUrlResult({ isPackaged: init.isPackaged })
  if (!resolved.ok) {
    return { ok: false, error: unconfiguredError(resolved.reason, path) }
  }

  const url = `${resolved.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onAbort = (): void => controller.abort()
  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const headers: Record<string, string> = {
      ...(init.headers || {}),
      ...(init.plazaUserToken
        ? { Authorization: `Bearer ${init.plazaUserToken}` }
        : init.skipAuth
          ? {}
          : authHeaders(init.auth))
    }
    const response = await fetch(url, {
      method: init.method || 'GET',
      headers,
      body: init.body,
      signal: controller.signal
    })

    let body: unknown
    try {
      const bounded = await readResponseTextBounded(
        response,
        MAX_GATEWAY_RESPONSE_CHARS,
        controller.signal
      )
      if (!bounded.ok) {
        if (bounded.reason === 'too_large') {
          return {
            ok: false,
            error: toSharedError(
              {
                code: 'INVALID_ARGUMENT',
                message: isPlazaGatewayPath(path) ? '分享广场响应过大。' : 'AI 网关响应过大。',
                retryable: false
              },
              'INVALID_ARGUMENT'
            )
          }
        }
        if (bounded.reason === 'aborted') {
          return {
            ok: false,
            error: toSharedError(
              { code: 'REQUEST_CANCELLED', message: '请求已取消。', retryable: false },
              'REQUEST_CANCELLED'
            )
          }
        }
        return {
          ok: false,
          error: toSharedError(
            { code: 'UNKNOWN', message: gatewayInvalidResponseMessage(path), retryable: true },
            'UNKNOWN'
          )
        }
      }
      body = bounded.text ? JSON.parse(bounded.text) : null
    } catch {
      return {
        ok: false,
        error: toSharedError(
          {
            code: 'UNKNOWN',
            message: gatewayInvalidResponseMessage(path),
            retryable: true
          },
          'UNKNOWN'
        )
      }
    }

    return { ok: true, status: response.status, body }
  } catch (error) {
    const cancelled =
      (error instanceof Error && error.name === 'AbortError') || (init.signal?.aborted ?? false)
    return {
      ok: false,
      error: toSharedError(
        {
          code: cancelled ? 'REQUEST_CANCELLED' : 'UNKNOWN',
          message: gatewayConnectionMessage(path, cancelled),
          retryable: !cancelled
        },
        cancelled ? 'REQUEST_CANCELLED' : 'UNKNOWN'
      )
    }
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', onAbort)
  }
}

export async function gatewayAsrMultipart(input: {
  audioBase64: string
  mimeType: string
  language?: string
  sessionId?: string
  provider?: string
  signal?: AbortSignal
  isPackaged?: boolean
  auth?: GatewayAuth
}): Promise<GatewayJsonResult> {
  if (!input.audioBase64 || input.audioBase64.length > Math.ceil((5 * 1024 * 1024 * 4) / 3) + 8) {
    return {
      ok: false,
      error: toSharedError(
        { code: 'INVALID_ARGUMENT', message: '录音数据过大。', retryable: false },
        'INVALID_ARGUMENT'
      )
    }
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(input.audioBase64, 'base64')
  } catch {
    return {
      ok: false,
      error: toSharedError(
        { code: 'INVALID_ARGUMENT', message: '录音数据无效。', retryable: false },
        'INVALID_ARGUMENT'
      )
    }
  }
  if (!bytes.length) {
    return {
      ok: false,
      error: toSharedError(
        { code: 'INVALID_ARGUMENT', message: '录音数据无效。', retryable: false },
        'INVALID_ARGUMENT'
      )
    }
  }

  const form = new FormData()
  const blob = new Blob([Uint8Array.from(bytes)], { type: input.mimeType || 'audio/wav' })
  form.append('file', blob, 'recording.wav')
  if (input.language) form.append('language', input.language)
  if (input.sessionId) form.append('sessionId', input.sessionId)
  if (input.provider) form.append('provider', input.provider)

  return gatewayJson('/api/asr/transcribe', {
    method: 'POST',
    body: form,
    signal: input.signal,
    isPackaged: input.isPackaged,
    auth: input.auth
  })
}

export async function gatewayImageUpload(input: {
  imageBase64: string
  mimeType: string
  fileName: string
  signal?: AbortSignal
  isPackaged?: boolean
  auth?: GatewayAuth
}): Promise<GatewayJsonResult> {
  let bytes: Buffer
  try {
    bytes = Buffer.from(input.imageBase64, 'base64')
  } catch {
    return {
      ok: false,
      error: toSharedError(
        { code: 'INVALID_ARGUMENT', message: '图片数据无效。', retryable: false },
        'INVALID_ARGUMENT'
      )
    }
  }

  const form = new FormData()
  const blob = new Blob([Uint8Array.from(bytes)], { type: input.mimeType })
  form.append('file', blob, input.fileName)
  return gatewayJson('/api/images/upload', {
    method: 'POST',
    body: form,
    signal: input.signal,
    isPackaged: input.isPackaged,
    auth: input.auth
  })
}

export async function gatewayQaAsk(input: {
  question: string
  asset?: Record<string, unknown>
  provider?: string
  signal?: AbortSignal
  isPackaged?: boolean
  auth?: GatewayAuth
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/qa/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: input.question,
      asset: input.asset || {},
      ...(input.provider ? { provider: input.provider } : {})
    }),
    signal: input.signal,
    isPackaged: input.isPackaged,
    auth: input.auth
  })
}

export async function gatewayTtsSynthesize(input: {
  text: string
  voicePurpose?: string
  provider?: string
  signal?: AbortSignal
  isPackaged?: boolean
  auth?: GatewayAuth
}): Promise<GatewayJsonResult> {
  return gatewayJson('/api/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      voicePurpose: input.voicePurpose || 'qa_answer',
      ...(input.provider ? { provider: input.provider } : {})
    }),
    signal: input.signal,
    isPackaged: input.isPackaged,
    auth: input.auth
  })
}

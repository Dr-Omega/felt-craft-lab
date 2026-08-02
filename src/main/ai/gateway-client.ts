import { toSharedError, type SharedError } from '@shared/contracts/error'

const DEFAULT_DEV_GATEWAY = 'http://127.0.0.1:8788'
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Resolve Flask AI Gateway base URL for Main-process forwarding only.
 * - Dev: default localhost:8788 unless AI_GATEWAY_BASE_URL is set
 * - Packaged: AI_GATEWAY_BASE_URL is required (remote Gateway; no local Python sidecar)
 */
export function resolveAiGatewayBaseUrl(options: { isPackaged?: boolean } = {}): string {
  const fromEnv = (process.env.AI_GATEWAY_BASE_URL || '').trim().replace(/\/+$/, '')
  if (fromEnv) return fromEnv
  if (options.isPackaged) return ''
  return DEFAULT_DEV_GATEWAY
}

export type GatewayJsonResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: SharedError }

export async function gatewayJson(
  path: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: BodyInit | null
    timeoutMs?: number
    signal?: AbortSignal
    isPackaged?: boolean
  } = {}
): Promise<GatewayJsonResult> {
  const base = resolveAiGatewayBaseUrl({ isPackaged: init.isPackaged })
  if (!base) {
    return {
      ok: false,
      error: toSharedError(
        {
          code: 'UNKNOWN',
          message: 'AI 网关未配置。正式环境请设置 AI_GATEWAY_BASE_URL。',
          retryable: false
        },
        'UNKNOWN'
      )
    }
  }

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onAbort = (): void => controller.abort()
  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const response = await fetch(url, {
      method: init.method || 'GET',
      headers: init.headers,
      body: init.body,
      signal: controller.signal
    })

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return {
        ok: false,
        error: toSharedError(
          {
            code: 'UNKNOWN',
            message: 'AI 网关响应无效。',
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
          message: cancelled ? '请求已取消。' : '无法连接 AI 服务，请稍后重试。',
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
}): Promise<GatewayJsonResult> {
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
    isPackaged: input.isPackaged
  })
}

export async function gatewayQaAsk(input: {
  question: string
  asset?: Record<string, unknown>
  provider?: string
  signal?: AbortSignal
  isPackaged?: boolean
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
    isPackaged: input.isPackaged
  })
}

export async function gatewayTtsSynthesize(input: {
  text: string
  voicePurpose?: string
  provider?: string
  signal?: AbortSignal
  isPackaged?: boolean
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
    isPackaged: input.isPackaged
  })
}

/**
 * Renderer AI client — always goes through Preload/Main proxy.
 * Do not fetch Flask directly (no CORS; webSecurity stays true).
 */

export type AiAsrTranscribeInput = {
  audioBase64: string
  mimeType: string
  language?: string
  sessionId?: string
  provider?: string
}

export type AiQaAskInput = {
  question: string
  asset?: Record<string, unknown>
  provider?: string
}

export type AiTtsSynthesizeInput = {
  text: string
  voicePurpose?: string
  provider?: string
}

function requireAiApi(): NonNullable<Window['electronAPI']>['ai'] {
  const api = window.electronAPI?.ai
  if (!api) {
    throw new Error('electronAPI.ai 不可用：请在 Electron 中通过 Preload 调用 AI 服务。')
  }
  return api
}

export const aiClient = {
  health: (): Promise<unknown> => requireAiApi().health(),
  asrTranscribe: (input: AiAsrTranscribeInput): Promise<unknown> => requireAiApi().asrTranscribe(input),
  qaAsk: (input: AiQaAskInput): Promise<unknown> => requireAiApi().qaAsk(input),
  ttsSynthesize: (input: AiTtsSynthesizeInput): Promise<unknown> => requireAiApi().ttsSynthesize(input)
}

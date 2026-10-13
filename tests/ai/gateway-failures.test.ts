import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatewayJson } from '../../src/main/ai/gateway-client'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('gateway failure classification', () => {
  it('labels request deadline as retryable service timeout, not user cancellation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const pending = gatewayJson('/api/asr/transcribe', { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'ASR_TIMEOUT', retryable: true } })
  })

  it('keeps explicit cancellation non-retryable', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const pending = gatewayJson('/api/story/rewrite', { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'REQUEST_CANCELLED', retryable: false } })
  })

  it('does not expose network exception details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private endpoint credentials')))
    const result = await gatewayJson('/api/qa/ask')
    expect(result).toMatchObject({ ok: false, error: { retryable: true } })
    expect(JSON.stringify(result)).not.toContain('private endpoint')
  })
})

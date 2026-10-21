import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatewayJson, gatewayStoryRewrite } from '../../src/main/ai/gateway-client'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('gateway failure classification', () => {
  it('correlates story requests without logging text or credentials and preserves text on timeout', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetch)
    const pending = gatewayStoryRewrite({workId:'work-private',text:'private story',context:{},auth:{token:'private-token',installationId:'installation'}})
    await vi.advanceTimersByTimeAsync(60_000)
    const response = await pending
    expect(response).toMatchObject({ok:false,error:{code:'QA_TIMEOUT',message:expect.stringContaining('故事整理'),requestId:expect.any(String)}})
    const id = fetch.mock.calls[0][1].headers['X-Felt-Request-Id']
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(log.mock.calls)).toContain(id)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private story|private-token|work-private/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
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

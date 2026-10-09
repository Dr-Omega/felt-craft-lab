import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../../src/main/ai/gateway-config', () => ({ resolveAiGatewayBaseUrlResult: () => ({ ok: true, baseUrl: 'http://127.0.0.1:8788' }) }))
import { plazaFetchMediaBytes } from '../../src/main/plaza/gateway-plaza'

afterEach(() => vi.unstubAllGlobals())
it('rejects non-media paths and traversal before any authenticated fetch', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  for (const path of ['/api/rewards/dashboard', '/api/plaza/media/../auth/login', '//example.org/image.png', '/api/plaza/media/x.png?secret=1']) {
    expect((await plazaFetchMediaBytes({ token: 'token', previewMediaPath: path })).ok).toBe(false)
  }
  expect(fetcher).not.toHaveBeenCalled()
})
it('loads generated preview paths without following redirects', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
  vi.stubGlobal('fetch', fetcher)
  const path = '/api/plaza/media/0123456789abcdef0123456789abcdef.png'
  expect((await plazaFetchMediaBytes({ token: 'token', previewMediaPath: path })).ok).toBe(true)
  expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8788' + path, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
})

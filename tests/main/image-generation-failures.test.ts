import { describe, expect, it, vi } from 'vitest'
import type { GenerationSpec } from '../../src/shared/contracts/generation-spec'
import type { ProviderPromptPayload } from '../../src/shared/contracts/generation-candidate'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '.' } }))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('../../src/main/ai/session-token', () => ({ getValidSessionToken: vi.fn().mockResolvedValue({ ok: true, session: { token: 'test-only', installationId: 'test-only' } }) }))
vi.mock('../../src/main/ai/gateway-client', () => ({ gatewayImageGenerate: vi.fn() }))

import { gatewayImageGenerate } from '../../src/main/ai/gateway-client'
import { generateCandidatePng } from '../../src/main/image-generation/from-gateway'

const payload = { positiveText: 'flower', width: 512, height: 512 } as ProviderPromptPayload
const spec = { assetRole: 'core_pattern' } as GenerationSpec

describe('image generation failure propagation', () => {
  it('preserves missing-service explanation instead of reporting a corrupt image', async () => {
    vi.mocked(gatewayImageGenerate).mockResolvedValue({ ok: true, status: 503, body: {
      ok: false, error: { code: 'UNKNOWN', message: '图片生成服务尚未配置，请联系管理员。', retryable: false }
    } })
    await expect(generateCandidatePng(payload, spec)).rejects.toThrow('尚未配置')
  })

  it('does not treat an HTTP failure as a valid image', async () => {
    vi.mocked(gatewayImageGenerate).mockResolvedValue({ ok: true, status: 502, body: { html: 'private upstream diagnostics' } })
    await expect(generateCandidatePng(payload, spec)).rejects.toThrow('服务配置')
  })
})

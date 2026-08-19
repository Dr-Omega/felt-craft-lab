import { describe, expect, it } from 'vitest'
import { decodeGatewayImagePng } from '../../src/main/image-generation'
import { MINIMAL_PNG_BYTES } from '../persistence/fixtures'

describe('decodeGatewayImagePng', () => {
  it('accepts a PNG envelope and rejects missing or non-png payloads', () => {
    const encoded = Buffer.from(MINIMAL_PNG_BYTES).toString('base64')
    const ok = decodeGatewayImagePng({ ok: true, result: { imageBase64: encoded } })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.bytes.subarray(0, 8).equals(Buffer.from(MINIMAL_PNG_BYTES.subarray(0, 8)))).toBe(true)

    const withQuality = decodeGatewayImagePng({
      ok: true,
      result: {
        imageBase64: encoded,
        width: 64,
        height: 64,
        quality: { verdict: 'WARN', messages: ['颜色有点多，制作时可能会比较碎。'] }
      }
    })
    expect(withQuality.ok).toBe(true)
    if (!withQuality.ok) return
    expect(withQuality.quality).toEqual({
      verdict: 'WARN',
      messages: ['颜色有点多，制作时可能会比较碎。']
    })
    expect(withQuality.width).toBe(64)

    expect(decodeGatewayImagePng({ ok: true, result: { imageBase64: 'not-png' } }).ok).toBe(false)
    expect(decodeGatewayImagePng({ ok: false, error: { code: 'UNKNOWN' } }).ok).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeCanvasUpload, validateImageIntake } from '../../src/renderer/src/fabrication/canvas-intake'

afterEach(() => vi.unstubAllGlobals())

describe('Canvas upload boundary', () => {
  it.each(['image/jpeg', 'image/png'])('keeps %s original bytes without Canvas conversion', async type => {
    const bytes = type === 'image/jpeg' ? new Uint8Array([255,216,255,224,1,2,3,255,217])
      : new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])
    vi.stubGlobal('Image', class { naturalWidth=1024; naturalHeight=1024; src=''; async decode() {} })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:original'), revokeObjectURL: vi.fn() })
    const createElement = vi.fn(() => { throw new Error('Canvas must not be used') })
    vi.stubGlobal('document', { createElement })
    expect(await normalizeCanvasUpload(new File([bytes], 'original', {type}))).toEqual(bytes)
    expect(createElement).not.toHaveBeenCalled()
  })
  it('accepts original-size PNG and JPEG, without downsampling', () => {
    expect(() => validateImageIntake('image/png', 1024, 1024, 1024)).not.toThrow()
    expect(() => validateImageIntake('image/jpeg', 1024, 4000, 4000)).not.toThrow()
  })
  it.each(['image/svg+xml', 'image/gif', 'text/plain', ''])('rejects unsupported type %s', type => {
    expect(() => validateImageIntake(type, 100)).toThrow('PNG 或 JPEG')
  })
  it.each([0, -1, 10 * 1024 * 1024 + 1])('rejects invalid byte count %s', size => {
    expect(() => validateImageIntake('image/png', size)).toThrow('10MB')
  })
  it.each([[4097, 1], [4096, 4096], [0, 10]])('rejects unsupported dimensions %s × %s', (w, h) => {
    expect(() => validateImageIntake('image/png', 100, w, h)).toThrow('尺寸')
  })
})

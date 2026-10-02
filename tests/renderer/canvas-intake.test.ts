import { describe, expect, it } from 'vitest'
import { validateImageIntake } from '../../src/renderer/src/fabrication/canvas-intake'

describe('Canvas upload boundary', () => {
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

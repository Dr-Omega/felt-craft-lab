import { describe, expect, it } from 'vitest'
import { parseFeltResourceByteRange } from '../../src/main/resource/range'

describe('parseFeltResourceByteRange', () => {
  it('parses bounded, open-ended, and suffix byte ranges', () => {
    expect(parseFeltResourceByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseFeltResourceByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 })
    expect(parseFeltResourceByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
  })

  it('clamps a range end and rejects invalid ranges', () => {
    expect(parseFeltResourceByteRange('bytes=8-20', 10)).toEqual({ start: 8, end: 9 })
    expect(parseFeltResourceByteRange('bytes=10-', 10)).toBeNull()
    expect(parseFeltResourceByteRange('bytes=4-2', 10)).toBeNull()
    expect(parseFeltResourceByteRange('bytes=0-1,4-5', 10)).toBeNull()
    expect(parseFeltResourceByteRange(null, 10)).toBeUndefined()
  })
})

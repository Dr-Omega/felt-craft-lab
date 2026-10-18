import { describe, expect, it } from 'vitest'
import { psdMaskContours, signedRingArea } from '../../src/renderer/src/projection/psd-mask-contours'

function mask(rows: string[]) {
  const width = rows[0].length, height = rows.length, rgba = new Uint8ClampedArray(width * height * 4)
  rows.forEach((row, y) => [...row].forEach((v, x) => { rgba[(y * width + x) * 4 + 3] = v === '#' ? 255 : 0 }))
  return psdMaskContours(rgba, width, height)
}
describe('authored PSD alpha contours (no segmentation or cleanup)', () => {
  it('retains holes, disconnected islands, single pixels and one-pixel-wide long strips', () => {
    const polygons = mask(['#####..#', '#...#..#', '#...#..#', '#...#..#', '#####..#', '........', '#.......'])
    expect(polygons).toHaveLength(3)
    expect(polygons.filter(p => p.length === 2)).toHaveLength(1)
    const areas = polygons.map(p => p.reduce((a, ring) => a + signedRingArea(ring), 0)).sort((a, b) => a - b)
    expect(areas).toEqual([1, 5, 16])
    expect(polygons.flat()).toContainEqual([[7, 0], [8, 0], [8, 5], [7, 5]])
  })
  it('does not bridge corner-touching regions or change their shape', () => {
    const polygons = mask(['#.', '.#'])
    expect(polygons).toHaveLength(2)
    expect(polygons.map(p => signedRingArea(p[0]))).toEqual([1, 1])
  })
  it('preserves exact filled area for 1000 reproducible complex masks, including nested islands', () => {
    const contains = (x: number, y: number, ring: number[][]) => {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [a, b] = ring[i], [c, d] = ring[j]
        if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit
      }
      return hit
    }
    let seed = 123456
    for (let n = 0; n < 1000; n++) {
      const rows = Array.from({ length: 8 }, () => Array.from({ length: 9 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed % 5 < 3 ? '#' : '.'
      }).join(''))
      const polygons = mask(rows)
      const area = polygons.flat().reduce((sum, ring) => sum + signedRingArea(ring), 0)
      expect(area).toBe(rows.join('').split('').filter(v => v === '#').length)
      rows.forEach((row, y) => [...row].forEach((value, x) => {
        const reconstructed = polygons.some(p => contains(x + .5, y + .5, p[0]) && !p.slice(1).some(hole => contains(x + .5, y + .5, hole)))
        expect(reconstructed).toBe(value === '#')
      }))
    }
  })
  it('uses alpha, not RGB (opaque white is material); rejects malformed buffers', () => {
    expect(psdMaskContours(new Uint8ClampedArray([255,255,255,255, 0,0,0,0]), 2, 1)).toEqual([[[[0,0],[1,0],[1,1],[0,1]]]])
    expect(() => psdMaskContours(new Uint8ClampedArray(3), 1, 1)).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { acceptsGuidedDrop, guidedStepReady } from '../../src/renderer/src/learning-zone/guided-placement'
import type { GameSticker } from '../../src/renderer/src/learning-zone/game-client'

const sticker = { targetArea: { minX: 300, maxX: 400, minY: 200, maxY: 300 }, tolerance: 20 } as GameSticker
const bounds = { minX: 100, minY: 50, maxX: 1100, maxY: 550 }
describe('guided drop coordinates', () => {
  it.each([1, .5, 1.5])('accepts target centers at viewport scale %s', scale => {
    const rect = { left: 40, top: 30, width: 1000 * scale, height: 500 * scale }
    expect(acceptsGuidedDrop(sticker, bounds, rect, 40 + 250 * scale, 30 + 200 * scale)).toBe(true)
    expect(acceptsGuidedDrop(sticker, bounds, rect, 40 + 180 * scale, 30 + 130 * scale)).toBe(true)
    expect(acceptsGuidedDrop(sticker, bounds, rect, 40 + 179 * scale, 30 + 130 * scale)).toBe(false)
  })
  it('rejects outside, invalid, and zero-size surfaces', () => {
    const rect = { left: 40, top: 30, width: 1000, height: 500 }
    expect(acceptsGuidedDrop(sticker, bounds, rect, 0, 0)).toBe(false)
    expect(acceptsGuidedDrop(sticker, bounds, rect, NaN, 200)).toBe(false)
    expect(acceptsGuidedDrop(sticker, bounds, { ...rect, width: 0 }, 290, 230)).toBe(false)
  })
})
describe('automatic learning completion gate', () => {
  const expected = ['zh', 'en', 'intro']
  it('requires placement AND all real narration completions', () => {
    expect(guidedStepReady(false, false, false, expected, expected)).toBe(false)
    expect(guidedStepReady(true, true, false, expected, expected)).toBe(false)
    expect(guidedStepReady(true, false, true, expected, expected)).toBe(false)
    expect(guidedStepReady(true, false, false, ['zh'], expected)).toBe(false)
    expect(guidedStepReady(true, false, false, ['intro', 'en', 'zh'], expected)).toBe(false)
    expect(guidedStepReady(true, false, false, expected, expected)).toBe(true)
  })
})

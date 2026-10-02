import { describe, it, expect } from 'vitest'
import { initialColors, validateBinding, validateColors, validHex } from '../../src/shared/fabrication-colors'
import { validScene } from './contracts.fixtures'
import type { FabricationView } from '../../src/shared/fabrication-desktop'
import { tintPixels, hsvHex } from '../../src/renderer/src/fabrication/recolor'

const view = { resultSha256: 'a'.repeat(64), steps: [
  { step: 1, pieceIds: ['bottom'], colorSlotId: 'red', rgb: [255,0,0] },
  { step: 2, pieceIds: ['left','right'], colorSlotId: 'green', rgb: [0,255,0] },
  { step: 3, pieceIds: ['top'], colorSlotId: 'red', rgb: [255,0,0] }
] } as FabricationView
describe('whole work-layer colors, not color-slot-wide or piece-wide edits', () => {
  it('binds an element to its preserved outer zIndex independently of internal layerIndex', () => {
    const binding = validateBinding({ scene: validScene, objectId: validScene.objects[0].objectId })
    const colors = initialColors(view, binding)
    expect(colors.binding?.scene.objects[0].zIndex).toBe(1)
    expect(colors.layers.map(l => l.layerIndex)).toEqual([0,1,2])
    expect(() => validateBinding({ scene: validScene, objectId: 'missing' })).toThrow()
    expect(() => validateBinding({ scene: {} })).toThrow()
  })
  it('keeps repeated colors at different levels independent and updates all member pieces', () => {
    const original = initialColors(view), edit = structuredClone(original)
    edit.layers[1].hex = '#112233'
    const result = validateColors(edit, original)
    expect(result.layers.map(l => l.hex)).toEqual(['#FF0000','#112233','#FF0000'])
    expect(result.layers[1].pieceIds).toEqual(['left','right'])
    expect(result.layers.map(l => l.layerIndex)).toEqual([0,1,2])
    edit.layers[0].hex = '#FFFFFF'
    expect(validateColors(edit, original).layers[2].hex).toBe('#FF0000')
  })
  it('rejects order, source and member tampering', () => {
    const original = initialColors(view)
    for (const mutate of [
      (v: typeof original) => { v.layers.reverse() },
      (v: typeof original) => { v.layers[1].pieceIds.pop() },
      (v: typeof original) => { v.layers[1].layerIndex = 0 },
      (v: typeof original) => { v.layers[0].originalHex = '#000000' },
      (v: typeof original) => { v.resultSha256 = 'other' }
    ]) { const edit = structuredClone(original); mutate(edit); expect(() => validateColors(edit, original)).toThrow() }
  })
  it('rejects duplicate membership and discontinuous steps', () => {
    const invalid = structuredClone(view); invalid.steps[1].pieceIds = ['left','left']
    expect(() => initialColors(invalid)).toThrow()
    invalid.steps[1].pieceIds = ['bottom']; expect(() => initialColors(invalid)).toThrow()
    invalid.steps[1].pieceIds = ['other']; invalid.steps[1].step = 8
    expect(() => initialColors(invalid)).toThrow()
  })
  it('preserves exact alpha including holes and semi-transparent edges without modifying the source', () => {
    const source = new Uint8ClampedArray([1,2,3,255, 4,5,6,0, 7,8,9,128, 11,12,13,255])
    expect(Array.from(tintPixels(source, '#AABBCC'))).toEqual([170,187,204,255,4,5,6,0,170,187,204,128,170,187,204,255])
    expect(source[0]).toBe(1)
  })
  it('accepts RGB only and supports full hue/saturation/value', () => {
    for (const value of ['red','#ff00','url(x)',null,'#GG0000']) expect(() => validHex(value)).toThrow()
    expect(validHex('#ab12cd')).toBe('#AB12CD')
    expect(hsvHex(120,1,1)).toBe('#00FF00')
    expect(hsvHex(240,0,1)).toBe('#FFFFFF')
    expect(hsvHex(240,1,0)).toBe('#000000')
  })
})

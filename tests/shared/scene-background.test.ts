import { describe, expect, it } from 'vitest'
import { artworkBackgroundColor } from '../../src/shared/scene-background'
import { validateSceneDocument } from '../../src/shared/contracts'
import { validScene } from './contracts.fixtures'

describe('UI paper versus artwork background', () => {
  it('recognizes only the known old automatic paper color, not arbitrary white artwork', () => {
    expect(artworkBackgroundColor({ width: 100, height: 100, backgroundColor: '#fff8e7' })).toBeUndefined()
    expect(artworkBackgroundColor({ width: 100, height: 100 })).toBeUndefined()
    for (const color of ['#FFFFFF', '#000000', '#123456']) {
      expect(artworkBackgroundColor({ width: 100, height: 100, backgroundColor: color })).toBe(color)
    }
    expect(artworkBackgroundColor({ width: 100, height: 100, backgroundColor: '#FFF8E7', backgroundColorSource: 'user' })).toBe('#FFF8E7')
  })

  it('validates explicit color intent without accepting arbitrary flags or a missing color', () => {
    for (const backgroundColorSource of ['user', 'ui', true]) {
      expect(validateSceneDocument({ ...validScene, canvas: { ...validScene.canvas, backgroundColorSource } }).ok)
        .toBe(backgroundColorSource === 'user')
    }
    expect(validateSceneDocument({ ...validScene, canvas: { width: 100, height: 100, backgroundColorSource: 'user' } }).ok).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  choiceFromMetaphor,
  choiceFromSpecificInput,
  maxLayerWidthMmForSubject,
  parseSpecificSizeCm
} from '../../src/renderer/src/projection/subject-size'

describe('subject-size', () => {
  it('parses cm dimensions with optional unit markers', () => {
    expect(parseSpecificSizeCm('12×15')).toEqual({ widthCm: 12, heightCm: 15 })
    expect(parseSpecificSizeCm('12cm×15cm')).toEqual({ widthCm: 12, heightCm: 15 })
  })

  it('maps metaphor options to layout width', () => {
    const choice = choiceFromMetaphor('apple')
    expect(choice?.label).toBe('一个苹果')
    expect(maxLayerWidthMmForSubject(choice!)).toBe(80)
  })

  it('uses the longer edge from specific input', () => {
    const choice = choiceFromSpecificInput('10×25')
    expect(choice?.targetLongEdgeMm).toBe(250)
  })
})

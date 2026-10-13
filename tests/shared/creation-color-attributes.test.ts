import { describe, expect, it } from 'vitest'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'
import { colorLinesFromSpec } from '../../src/shared/creation-intent/plan-card'
import { subjectsNeedColors } from '../../src/shared/creation-intent/plan-fields'
import { evaluateGenerationSpecCompleteness } from '../../src/shared/creation-intent/completeness'

describe('plan colors are not all subject attributes', () => {
  it('keeps size in subject attributes but excludes it from colors', () => {
    const spec = createEmptyGenerationSpec('core_pattern')
    spec.content.primarySubjects = [{ name: '皮卡丘', attributes: ['黄色', '大'] }]
    expect(colorLinesFromSpec(spec)).toEqual(['黄色皮卡丘'])
    expect(spec.content.primarySubjects[0].attributes).toEqual(['黄色', '大'])
    expect(subjectsNeedColors(spec)).toBe(false)
  })
  it('does not treat size or shape alone as a chosen color', () => {
    const spec = createEmptyGenerationSpec('core_pattern')
    spec.content.primarySubjects = [{ name: '小熊', attributes: ['大', '圆圆的'] }]
    expect(colorLinesFromSpec(spec)).toEqual([])
    expect(subjectsNeedColors(spec)).toBe(true)
    expect(evaluateGenerationSpecCompleteness(spec).missingFields).toContain('content.preferredColors')
  })
})

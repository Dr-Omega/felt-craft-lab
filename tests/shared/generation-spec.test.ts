import { describe, expect, it } from 'vitest'
import {
  createEmptyGenerationSpec,
  FELT_COMMON_STYLE_CONSTRAINTS,
  validateGenerationSpec
} from '../../src/shared/contracts'

function coreSpec() {
  const spec = createEmptyGenerationSpec('core_pattern')
  spec.content.primarySubjects = [{ name: '玉兔', count: 1, attributes: ['白色'] }]
  spec.content.actionOrRelationship = '抱着月饼'
  spec.content.preferredColors = ['白色', '金色']
  spec.content.forbiddenElements = ['真实毛发']
  return spec
}

describe('GenerationSpec contract', () => {
  it('accepts valid core_pattern, element, and background specs', () => {
    expect(validateGenerationSpec(coreSpec()).ok).toBe(true)

    const element = createEmptyGenerationSpec('element')
    element.content.primarySubjects = [{ name: '灯笼' }]
    expect(validateGenerationSpec(element).ok).toBe(true)

    const background = createEmptyGenerationSpec('background')
    background.content.environmentDescription = '中秋庭院夜空'
    expect(validateGenerationSpec(background).ok).toBe(true)
  })

  it('rejects unknown roles and role/constraint mismatches', () => {
    expect(validateGenerationSpec({ ...coreSpec(), assetRole: 'sticker' }).ok).toBe(false)
    const mismatched = coreSpec()
    mismatched.roleConstraints = {
      role: 'element',
      independentUnit: true,
      avoidUnrelatedObjects: true,
      preferSeparableBackground: true,
      simplifyStructure: true
    }
    expect(validateGenerationSpec(mismatched).ok).toBe(false)
  })

  it('rejects Prompt and Provider pollution on the domain spec', () => {
    expect(validateGenerationSpec({ ...coreSpec(), prompt: 'cute rabbit, cinematic lighting' }).ok).toBe(false)
    expect(validateGenerationSpec({ ...coreSpec(), provider: 'minimax' }).ok).toBe(false)
    expect(validateGenerationSpec({ ...coreSpec(), model: 'qwen-image' }).ok).toBe(false)
    expect(validateGenerationSpec({ ...coreSpec(), referenceImages: ['https://example.test/ref.png'] }).ok).toBe(false)
    expect(validateGenerationSpec({ ...coreSpec(), profileId: 'felt-seedream45-ref8-v1' }).ok).toBe(false)
    expect(validateGenerationSpec({ ...coreSpec(), systemPrompt: 'hidden policy' }).ok).toBe(false)
    expect(validateGenerationSpec({ ...coreSpec(), negativePrompt: 'fur, texture' }).ok).toBe(false)
    expect(
      validateGenerationSpec({
        ...coreSpec(),
        content: { ...coreSpec().content, prompt: 'write the final prompt' }
      }).ok
    ).toBe(false)
  })

  it('rejects attempts to change the frozen FeltStyleSpec', () => {
    const cinematic = coreSpec()
    cinematic.styleConstraints = {
      ...FELT_COMMON_STYLE_CONSTRAINTS,
      renderStyle: 'cinematic' as typeof FELT_COMMON_STYLE_CONSTRAINTS.renderStyle
    }
    expect(validateGenerationSpec(cinematic).ok).toBe(false)
  })

  it('does not require children to fill system default fields', () => {
    const minimal = createEmptyGenerationSpec('core_pattern')
    minimal.content.primarySubjects = [{ name: '熊猫' }]
    expect(validateGenerationSpec(minimal).ok).toBe(true)
    expect(minimal.styleConstraints).toEqual(FELT_COMMON_STYLE_CONSTRAINTS)
    expect(minimal.creationMode).toBe('guided')
  })
})

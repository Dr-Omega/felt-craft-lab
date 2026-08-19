import { describe, expect, it } from 'vitest'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'
import {
  applyGenerationSpecPatch,
  confirmGenerationSpec,
  LocalCreationIntentParser
} from '../../src/shared/creation-intent'
import {
  BASE_NEGATIVE_PHRASES,
  compileCanonicalPrompt,
  FELT_STYLE_PHRASES
} from '../../src/shared/prompt-compiler'

describe('confirm + Prompt Compiler', () => {
  it('refuses to compile before confirmation', async () => {
    const parser = new LocalCreationIntentParser()
    const spec = applyGenerationSpecPatch(
      createEmptyGenerationSpec('core_pattern'),
      await parser.parse({ text: '白色玉兔抱月饼，不要真实毛发' })
    )
    const refused = compileCanonicalPrompt(spec)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('NOT_CONFIRMED')
  })

  it('compiles a confirmed core pattern into a fixed Canonical Prompt', async () => {
    const parser = new LocalCreationIntentParser()
    const draft = applyGenerationSpecPatch(
      createEmptyGenerationSpec('core_pattern'),
      await parser.parse({ text: '白色玉兔抱月饼，不要真实毛发' })
    )
    const confirmed = confirmGenerationSpec(draft, '2026-08-18T12:00:00.000Z')
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return

    const compiled = compileCanonicalPrompt(confirmed.value)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    expect(compiled.value.schemaVersion).toBe(1)
    expect(compiled.value.assetRole).toBe('core_pattern')
    expect(compiled.value.sections.subject).toContain('白色玉兔')
    expect(compiled.value.sections.subject).toContain('月饼')
    expect(compiled.value.sections.action).toBe('抱')
    expect(compiled.value.sections.colors).toBeUndefined()
    expect(compiled.value.sections.style).toContain(FELT_STYLE_PHRASES.renderStyle)
    expect(compiled.value.sections.style).toContain(FELT_STYLE_PHRASES.perspective)
    expect(compiled.value.sections.role).toContain('核心图案')
    expect(compiled.value.positiveText).toContain(FELT_STYLE_PHRASES.renderStyle)
    expect(compiled.value.negativeText).toContain('真实毛发')
    for (const phrase of BASE_NEGATIVE_PHRASES) {
      expect(compiled.value.negativeText).toContain(phrase)
    }
    expect(compiled.value).not.toHaveProperty('provider')
    expect(compiled.value).not.toHaveProperty('model')
  })

  it('compiles role-specific role phrases for element and background', () => {
    const lantern = createEmptyGenerationSpec('element')
    lantern.content.primarySubjects = [{ name: '灯笼' }]
    const lanternConfirmed = confirmGenerationSpec(lantern, '2026-08-18T12:00:00.000Z')
    expect(lanternConfirmed.ok).toBe(true)
    if (!lanternConfirmed.ok) return
    const lanternPrompt = compileCanonicalPrompt(lanternConfirmed.value)
    expect(lanternPrompt.ok).toBe(true)
    if (!lanternPrompt.ok) return
    expect(lanternPrompt.value.sections.role).toContain('独立可摆放')
    expect(lanternPrompt.value.sections.subject).toBe('灯笼')

    const courtyard = createEmptyGenerationSpec('background')
    courtyard.content.environmentDescription = '中秋庭院'
    const courtyardConfirmed = confirmGenerationSpec(courtyard, '2026-08-18T12:00:00.000Z')
    expect(courtyardConfirmed.ok).toBe(true)
    if (!courtyardConfirmed.ok) return
    const courtyardPrompt = compileCanonicalPrompt(courtyardConfirmed.value)
    expect(courtyardPrompt.ok).toBe(true)
    if (!courtyardPrompt.ok) return
    expect(courtyardPrompt.value.sections.environment).toBe('中秋庭院')
    expect(courtyardPrompt.value.sections.role).toContain('满幅场景')
  })

  it('rejects confirming an incomplete core pattern', () => {
    const empty = createEmptyGenerationSpec('core_pattern')
    const refused = confirmGenerationSpec(empty)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('NOT_READY')
  })
})

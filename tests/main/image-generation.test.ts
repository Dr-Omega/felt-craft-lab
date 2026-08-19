import { describe, expect, it } from 'vitest'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'
import { generationSizeForRole } from '../../src/shared/contracts/generation-candidate'
import { PNG_SIGNATURE } from '../../src/main/resource/png'
import { renderMockFeltPng } from '../../src/main/image-generation'
import { compileCanonicalPrompt, toProviderPromptPayload } from '../../src/shared/prompt-compiler'
import { confirmGenerationSpec } from '../../src/shared/creation-intent'

describe('mock felt image provider', () => {
  it('renders a PNG candidate from a confirmed spec without Provider fields', () => {
    const spec = createEmptyGenerationSpec('core_pattern')
    spec.content.primarySubjects = [{ name: '玉兔', attributes: ['白色'] }, { name: '月饼' }]
    spec.content.actionOrRelationship = '抱'
    spec.content.preferredColors = ['白色', '金色']
    const confirmed = confirmGenerationSpec(spec, '2026-08-18T16:00:00.000Z')
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    const compiled = compileCanonicalPrompt(confirmed.value)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const payload = toProviderPromptPayload(compiled.value)
    expect(payload.width).toBe(generationSizeForRole('core_pattern').width)
    expect(payload).not.toHaveProperty('provider')

    const png = renderMockFeltPng(payload, confirmed.value)
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(png.length).toBeGreaterThan(256)
  })
})

import { describe, expect, it } from 'vitest'
import { CreationIntentSession } from '../../src/shared/creation-intent/session'
import { isSoundOnlyAction } from '../../src/shared/creation-intent/action-evidence'
import { buildCreationPlanFields } from '../../src/shared/creation-intent/plan-card'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'

describe('creation confirmation evidence', () => {
  it('asks for a real action instead of accepting a bare repeated sound', async () => {
    const session = new CreationIntentSession({ lockedRole: 'core_pattern', parser: {
      parse: async () => ({ content: { primarySubjects: [{ name: '马蹄螺哒哒哒' }], actionOrRelationship: '哒哒哒' } })
    } })
    const result = await session.submitText('我要一只马蹄螺哒哒哒')
    expect(result.spec.content.primarySubjects[0].name).toBe('马蹄螺哒哒哒')
    expect(result.spec.content.actionOrRelationship).toBeFalsy()
    expect(result.question?.field).toBe('content.actionOrRelationship')
    const repeated = await session.submitText('哒哒哒')
    expect(repeated.spec.content.actionOrRelationship).toBeFalsy()
  })
  it('does not discard an explicit action containing a sound', () => {
    expect(isSoundOnlyAction('一边跑一边哒哒叫')).toBe(false)
    expect(isSoundOnlyAction('走走')).toBe(false)
    expect(isSoundOnlyAction('哒，哒，哒')).toBe(true)
  })
  it('labels optional slots separately from the active clarification', () => {
    const fields = buildCreationPlanFields(createEmptyGenerationSpec('core_pattern'), 'content.actionOrRelationship')
    expect(fields.find(f => f.key === 'content.actionOrRelationship')?.optional).toBe(false)
    expect(fields.find(f => f.key === 'content.requiredElements')?.optional).toBe(true)
  })
})

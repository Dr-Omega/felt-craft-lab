import { describe, expect, it, vi } from 'vitest'
import { validateStoryRewriteIpcInput, withValidatedIpcInput } from '../../src/main/ai/input-guards'
import { normalizeStoryRewriteEnvelope } from '../../src/main/ai/normalize-envelope'
import { displayObjectOrder } from '../../src/renderer/src/workflows/work-display'
import { validFeltProject } from '../persistence/fixtures'

describe('creation flow integration boundaries', () => {
  const context = { workId: 'work', completionStatus: 'completed', subject: { name: '我的画' } }
  it('rejects wrong work or unfinished context before any provider call', async () => {
    const network = vi.fn()
    for (const invalid of [{ ...context, workId: 'other' }, { ...context, completionStatus: 'draft' }, {}]) {
      await withValidatedIpcInput(validateStoryRewriteIpcInput({ workId: 'work', text: '这是我的故事', context: invalid }), network)
    }
    expect(network).not.toHaveBeenCalled()
  })
  it('rejects overlong text before any provider call', async () => {
    const network = vi.fn()
    await withValidatedIpcInput(validateStoryRewriteIpcInput({ workId: 'work', text: 'a'.repeat(3001), context }), network)
    expect(network).not.toHaveBeenCalled()
  })
  it('rejects valid-looking drafts belonging to another artwork', () => {
    const draft = { workId: 'other', status: 'ready_for_review', suggestedTitle: '标题', suggestedStoryText: '故事' }
    expect(normalizeStoryRewriteEnvelope({ ok: true, result: draft }, 'work').ok).toBe(false)
    expect(normalizeStoryRewriteEnvelope({ ok: true, result: { ...draft, workId: 'work' } }, 'work').ok).toBe(true)
  })
  it('does not accept malformed follow-up responses as a completed story', () => {
    expect(normalizeStoryRewriteEnvelope({ ok: true, result: { workId: 'work', status: 'needs_more_input', followUpQuestions: ['one'] } }, 'work').ok).toBe(false)
  })
  it('orders visible scene elements by global zIndex rather than grouping by asset or color', () => {
    const scene = validFeltProject().scene, object = scene.objects[0]
    scene.objects = [{ ...object, objectId: 'upper', zIndex: 2 }, { ...object, objectId: 'lower', zIndex: 0 },
      { ...object, objectId: 'hidden', visible: false, zIndex: 3 }]
    scene.personalElements = [{ objectId: 'middle', personalAssetId: 'asset', versionId: 'version', visible: true,
      left: 0, top: 0, angle: 0, scaleX: 1, scaleY: 1, zIndex: 1, locked: false }]
    expect(displayObjectOrder(scene).map(item => item.objectId)).toEqual(['lower', 'middle', 'upper'])
  })
})

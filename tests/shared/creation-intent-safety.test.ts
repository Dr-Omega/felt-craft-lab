import { describe, expect, it } from 'vitest'
import {
  CreationIntentBlockedError,
  CreationIntentSession,
  FallbackCreationIntentParser,
  LocalCreationIntentParser,
  RemoteCreationIntentParser,
  applySkipPendingAnswer,
  isSkipClarificationAnswer
} from '../../src/shared/creation-intent'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'

describe('BLOCKED intent must not fall through to local fallback', () => {
  it('rethrows CreationIntentBlockedError from primary and never returns local subjects', async () => {
    const local = new LocalCreationIntentParser()
    const parser = new FallbackCreationIntentParser({
      primary: {
        parse: async () => {
          throw new CreationIntentBlockedError('这句话不太适合画，请换一个想法。')
        }
      },
      fallback: local
    })

    await expect(
      parser.parse({ text: '画一个炸弹', lockedRole: 'core_pattern' })
    ).rejects.toBeInstanceOf(CreationIntentBlockedError)
  })

  it('RemoteCreationIntentParser maps gateway QA_BLOCKED envelopes to CreationIntentBlockedError', async () => {
    const remote = new RemoteCreationIntentParser(async () => ({
      ok: false,
      error: { code: 'QA_BLOCKED', message: '这句话不太适合画，请换一个想法。', retryable: false }
    }))
    const wrapped = new FallbackCreationIntentParser({
      primary: remote,
      fallback: new LocalCreationIntentParser()
    })
    await expect(wrapped.parse({ text: '色情内容', lockedRole: 'core_pattern' })).rejects.toMatchObject({
      code: 'QA_BLOCKED'
    })
  })

  it('end-to-end session submit surfaces blocked errors instead of applying a local patch', async () => {
    const session = new CreationIntentSession({
      lockedRole: 'core_pattern',
      parser: new FallbackCreationIntentParser({
        primary: {
          parse: async () => {
            throw new CreationIntentBlockedError()
          }
        },
        fallback: new LocalCreationIntentParser()
      })
    })
    await expect(session.submitText('画一个炸弹')).rejects.toBeInstanceOf(CreationIntentBlockedError)
    expect(session.getSnapshot().spec.content.primarySubjects).toEqual([])
  })
})

describe('skip answers must not write into pending fields', () => {
  it('recognizes skip phrases', () => {
    for (const phrase of ['没有', '不用', '不要', '无', '随便', '你来定']) {
      expect(isSkipClarificationAnswer(phrase)).toBe(true)
    }
    expect(isSkipClarificationAnswer('红色')).toBe(false)
  })

  it('local pending bind ignores skip phrases for requiredElements', async () => {
    const local = new LocalCreationIntentParser()
    const patch = await local.parse({
      text: '没有',
      lockedRole: 'core_pattern',
      pendingField: 'content.requiredElements'
    })
    expect(patch.content?.requiredElements).toBeUndefined()
  })

  it('applySkipPendingAnswer clears pending without writing the phrase', () => {
    const base = createEmptyGenerationSpec('core_pattern')
    base.content.primarySubjects = [{ name: '熊猫' }]
    base.content.actionOrRelationship = '坐着'
    base.clarification = {
      roundCount: 2,
      askedFields: ['content.preferredColors'],
      pendingField: 'content.preferredColors'
    }
    const skipped = applySkipPendingAnswer(base, 'content.preferredColors')
    expect(skipped.clarification.pendingField).toBeNull()
    expect(skipped.content.preferredColors).toBeUndefined()
    expect(skipped.content.primarySubjects[0]?.name).toBe('熊猫')
  })

  it('session treats 没有 on required pending as skip without storing 没有', async () => {
    const session = new CreationIntentSession({
      lockedRole: 'core_pattern',
      parser: new LocalCreationIntentParser()
    })
    await session.submitText('黑白熊猫抱着红色皮球')
    // Manually set optional pending (required is not auto-asked) by patching through skip API path:
    const snap = session.getSnapshot()
    const withPending = {
      ...snap.spec,
      clarification: {
        ...snap.spec.clarification,
        pendingField: 'content.requiredElements',
        askedFields: [...snap.spec.clarification.askedFields, 'content.requiredElements']
      }
    }
    // Re-create session state via private field is not available — use submit after forcing via parser pending.
    const skipSession = new CreationIntentSession({
      lockedRole: 'core_pattern',
      parser: new LocalCreationIntentParser()
    })
    await skipSession.submitText('黑白熊猫抱着红色皮球')
    // Inject pending by answering a soft field path: use applySkipPendingAnswer then verify session skip path
    // by constructing a session that already awaits requiredElements.
    ;(skipSession as unknown as { spec: typeof withPending }).spec = withPending
    const after = await skipSession.submitText('没有')
    expect(after.spec.content.requiredElements ?? []).not.toContain('没有')
    expect(after.spec.clarification.pendingField).toBeNull()
  })
})

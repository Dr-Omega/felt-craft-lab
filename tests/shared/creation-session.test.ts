import { describe, expect, it } from 'vitest'
import { CreationIntentSession, LocalCreationIntentParser } from '../../src/shared/creation-intent'

describe('CreationIntentSession', () => {
  it('runs one complete sentence through parse, confirm, and compile', async () => {
    const session = new CreationIntentSession({ parser: new LocalCreationIntentParser() })
    const afterText = await session.submitText('一只黑白熊猫坐在地上抱着红色皮球')
    expect(afterText.phase).toBe('ready_to_confirm')
    expect(afterText.question).toBeNull()
    expect(afterText.spec.content.primarySubjects.map((item) => item.name)).toEqual(['熊猫', '皮球'])
    expect(afterText.spec.content.actionOrRelationship).toContain('坐在地上抱着')
    expect(afterText.spec.content.actionOrRelationship).toContain('皮球')

    const compiled = session.confirm('2026-08-18T14:00:00.000Z')
    expect(compiled.phase).toBe('compiled')
    expect(compiled.prompt?.positiveText).toContain('熊猫')
    expect(compiled.prompt?.positiveText).toContain('皮球')
    expect(compiled.prompt?.positiveText).toContain('坐在地上抱着')
    expect(compiled.prompt?.positiveText).toContain('皮球')
    expect(compiled.prompt?.positiveText).toContain('平面大色块')
  })

  it('marks an attached candidate as accepted', async () => {
    const session = new CreationIntentSession({ parser: new LocalCreationIntentParser() })
    await session.submitText('白色玉兔抱月饼，不要真实毛发')
    session.confirm('2026-08-18T14:00:00.000Z')
    session.attachCandidate({
      candidateId: '11111111-1111-4111-8111-111111111111',
      generationRequestId: '22222222-2222-4222-8222-222222222222',
      assetRole: 'core_pattern',
      status: 'REVIEWABLE',
      temporaryRef: 'felt-resource://preview/gen11111111111141118111111111111111.png',
      width: 512,
      height: 512,
      createdAt: '2026-08-18T14:00:00.000Z'
    })
    expect(session.getSnapshot().phase).toBe('generated')
    expect(session.markCandidateAccepted().phase).toBe('accepted')
    expect(session.getSnapshot().candidate?.status).toBe('ACCEPTED')
  })

  it('asks for an action when a core pattern only names the subject', async () => {
    const session = new CreationIntentSession({
      parser: new LocalCreationIntentParser(),
      lockedRole: 'core_pattern'
    })
    const first = await session.submitText('一只玉兔')
    expect(first.phase).toBe('awaiting_clarification')
    expect(first.question?.field).toBe('content.actionOrRelationship')

    const second = await session.submitText('抱着月饼')
    expect(second.phase).toBe('awaiting_clarification')
    expect(second.question?.field).toBe('content.preferredColors')
    expect(second.spec.content.actionOrRelationship).toContain('抱')

    const third = await session.submitText('白色')
    expect(third.phase).toBe('ready_to_confirm')
    expect(third.spec.content.preferredColors).toContain('白色')
  })

  it('asks for the subject when the first sentence has no object', async () => {
    const session = new CreationIntentSession({
      parser: new LocalCreationIntentParser(),
      lockedRole: 'element'
    })
    const first = await session.submitText('给我一个可以自己摆的')
    expect(first.phase).toBe('awaiting_clarification')
    expect(first.question?.field).toBe('content.primarySubjects')

    const second = await session.submitText('灯笼')
    expect(second.phase).toBe('ready_to_confirm')
    expect(second.spec.content.primarySubjects[0]?.name).toBe('灯笼')

    const compiled = session.confirm('2026-08-18T14:00:00.000Z')
    expect(compiled.phase).toBe('compiled')
    expect(compiled.prompt?.sections.subject).toBe('灯笼')
    expect(compiled.prompt?.sections.role).toContain('独立可摆放')
  })

  it('switches to background from a courtyard sentence', async () => {
    const session = new CreationIntentSession({ parser: new LocalCreationIntentParser() })
    const afterText = await session.submitText('做一个庭院背景')
    expect(afterText.spec.assetRole).toBe('background')
    expect(afterText.phase).toBe('ready_to_confirm')

    const compiled = session.confirm('2026-08-18T14:00:00.000Z')
    expect(compiled.prompt?.assetRole).toBe('background')
    expect(compiled.prompt?.sections.environment).toContain('庭院')
  })

  it('does not compile when the spec is still empty', () => {
    const session = new CreationIntentSession({ parser: new LocalCreationIntentParser() })
    const refused = session.confirm()
    expect(refused.phase).toBe('collecting')
    expect(refused.prompt).toBeNull()
    expect(refused.spec.confirmation.status).toBe('unconfirmed')
  })
})

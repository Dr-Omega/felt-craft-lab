import { describe, expect, it } from 'vitest'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'
import {
  applyGenerationSpecPatch,
  CreationIntentSession,
  enrichPatchForPendingField,
  FallbackCreationIntentParser,
  LocalCreationIntentParser,
  mergeGenerationSpecPatches,
  mergePatchActions,
  RemoteCreationIntentParser
} from '../../src/shared/creation-intent'

describe('P2 mergePatchActions (local + LLM same utterance)', () => {
  it('keeps the richer holding phrase instead of concatenating', () => {
    expect(mergePatchActions('抱着红色皮球', '抱着皮球')).toBe('抱着红色皮球')
    expect(mergePatchActions('抱着皮球', '抱着红色皮球')).toBe('抱着红色皮球')
  })

  it('stacks posture onto holding within one merge', () => {
    expect(mergePatchActions('抱着皮球', '坐在地上')).toBe('坐在地上抱着皮球')
  })
})

describe('P2 FallbackCreationIntentParser does not wipe supplements', () => {
  it('prefers local richer action when LLM returns a shorter holding phrase', async () => {
    const parser = new FallbackCreationIntentParser({
      fallback: new LocalCreationIntentParser(),
      primary: new RemoteCreationIntentParser(async () => ({
        ok: true,
        result: {
          patch: {
            content: {
              primarySubjects: [{ name: '熊猫' }],
              actionOrRelationship: '抱着皮球'
            }
          }
        }
      }))
    })
    const patch = await parser.parse({
      text: '黑白熊猫抱着红色皮球',
      lockedRole: 'core_pattern'
    })
    expect(patch.content?.actionOrRelationship).toContain('抱着')
    expect(patch.content?.actionOrRelationship).toContain('皮球')
    expect(patch.content?.primarySubjects?.map((item) => item.name)).toEqual(
      expect.arrayContaining(['熊猫', '皮球'])
    )
  })

  it('lets LLM posture stack with local holding on the same short utterance', async () => {
    const parser = new FallbackCreationIntentParser({
      fallback: {
        parse: async () => ({
          content: { actionOrRelationship: '抱着皮球' }
        })
      },
      primary: {
        parse: async () => ({
          content: { actionOrRelationship: '坐在地上' }
        })
      }
    })
    const patch = await parser.parse({ text: '坐在地上', lockedRole: 'core_pattern' })
    expect(patch.content?.actionOrRelationship).toBe('坐在地上抱着皮球')
  })
})

describe('P2 enrichPatchForPendingField', () => {
  it('attaches spoken colors onto existing subjects for the colors slot', () => {
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), {
      content: {
        primarySubjects: [{ name: '熊猫' }, { name: '皮球' }],
        actionOrRelationship: '抱着皮球'
      }
    })
    const enriched = enrichPatchForPendingField(
      'content.preferredColors',
      '黑白和红色',
      {},
      spec
    )
    expect(enriched.content?.primarySubjects).toEqual([
      { name: '熊猫', attributes: ['黑白'] },
      { name: '皮球', attributes: ['红色'] }
    ])
  })
})

describe('P2 LocalCreationIntentParser expansions', () => {
  const parser = new LocalCreationIntentParser()

  it('parses common child utterances into stable fields', async () => {
    const cases: Array<{ text: string; subjects: string[]; actionIncludes?: string; forbidden?: string }> = [
      { text: '黑白熊猫抱着红色皮球', subjects: ['熊猫', '皮球'], actionIncludes: '抱' },
      { text: '白色玉兔抱月饼，不要真实毛发', subjects: ['玉兔', '月饼'], actionIncludes: '抱', forbidden: '真实毛发' },
      { text: '蓝色小猫追蝴蝶', subjects: ['小猫', '蝴蝶'], actionIncludes: '追' },
      { text: '一只粉色小兔子坐着', subjects: ['兔子'], actionIncludes: '坐' },
      { text: '金色灯笼', subjects: ['灯笼'] },
      { text: '绿色小青蛙', subjects: ['小青蛙'] },
      { text: '小熊戴着围巾', subjects: ['小熊', '围巾'], actionIncludes: '戴' },
      { text: '黄色鸭子在水上', subjects: ['鸭子'] },
      { text: '熊猫和皮球一起玩', subjects: ['熊猫', '皮球'] },
      { text: '不要复杂背景', subjects: [], forbidden: '复杂背景' }
    ]
    for (const item of cases) {
      const patch = await parser.parse({ text: item.text, lockedRole: 'core_pattern' })
      if (item.subjects.length) {
        expect(patch.content?.primarySubjects?.map((s) => s.name), item.text).toEqual(
          expect.arrayContaining(item.subjects)
        )
      }
      if (item.actionIncludes) {
        expect(patch.content?.actionOrRelationship, item.text).toContain(item.actionIncludes)
      }
      if (item.forbidden) {
        expect(patch.content?.forbiddenElements, item.text).toEqual(
          expect.arrayContaining([item.forbidden])
        )
      }
    }
  })

  it('does not treat a posture answer as a color while colors are pending', async () => {
    const patch = await parser.parse({
      text: '坐在地上',
      lockedRole: 'core_pattern',
      pendingField: 'content.preferredColors'
    })
    expect(patch.content?.preferredColors).toBeUndefined()
    expect(patch.content?.actionOrRelationship).toContain('坐')
  })

  it('records 必须有 and 再加一个 supplements', async () => {
    const required = await parser.parse({ text: '必须有大眼睛', lockedRole: 'core_pattern' })
    expect(required.content?.requiredElements).toEqual(expect.arrayContaining(['大眼睛']))

    const added = await parser.parse({ text: '再加一个飞船', lockedRole: 'core_pattern' })
    expect(added.content?.primarySubjects?.map((item) => item.name)).toContain('飞船')
  })
})

describe('P2 session stacking with pending color answers', () => {
  it('keeps holding action when posture is added, then fills colors via pending field', async () => {
    const session = new CreationIntentSession({
      parser: new LocalCreationIntentParser(),
      lockedRole: 'core_pattern'
    })
    await session.submitText('熊猫抱着皮球')
    const afterPosture = await session.submitText('坐在地上')
    expect(afterPosture.spec.content.actionOrRelationship).toContain('坐在地上')
    expect(afterPosture.spec.content.actionOrRelationship).toContain('抱')
    expect(afterPosture.spec.content.primarySubjects.map((item) => item.name)).toEqual([
      '熊猫',
      '皮球'
    ])

    // Missing colors → clarification asks preferredColors
    expect(afterPosture.phase).toBe('awaiting_clarification')
    expect(afterPosture.question?.field).toBe('content.preferredColors')

    const afterColors = await session.submitText('黑白红色')
    expect(afterColors.phase).toBe('ready_to_confirm')
    const attrs = afterColors.spec.content.primarySubjects.flatMap((item) => item.attributes ?? [])
    expect(attrs).toEqual(expect.arrayContaining(['黑白', '红色']))
  })

  it('merges LLM posture overlay without dropping prior holding subjects', async () => {
    const session = new CreationIntentSession({
      lockedRole: 'core_pattern',
      parser: new FallbackCreationIntentParser({
        fallback: new LocalCreationIntentParser(),
        primary: new RemoteCreationIntentParser(async ({ text }) => {
          if (text.includes('坐在地上')) {
            return {
              ok: true,
              result: {
                patch: {
                  content: {
                    primarySubjects: [{ name: '熊猫' }],
                    actionOrRelationship: '坐在地上'
                  }
                }
              }
            }
          }
          return { ok: true, result: { patch: {} } }
        })
      })
    })
    await session.submitText('黑白熊猫抱着红色皮球')
    const stacked = await session.submitText('坐在地上')
    expect(stacked.spec.content.primarySubjects.map((item) => item.name)).toEqual(['熊猫', '皮球'])
    expect(stacked.spec.content.actionOrRelationship).toMatch(/坐在地上.*抱|抱.*坐在地上/)
  })
})

describe('P2 mergeGenerationSpecPatches preserves subject union', () => {
  it('unions subjects from local and remote', () => {
    const merged = mergeGenerationSpecPatches(
      {
        content: {
          primarySubjects: [
            { name: '熊猫', attributes: ['黑白'] },
            { name: '皮球', attributes: ['红色'] }
          ],
          actionOrRelationship: '抱着红色皮球'
        }
      },
      {
        content: {
          primarySubjects: [{ name: '熊猫' }],
          actionOrRelationship: '坐在地上'
        }
      }
    )
    expect(merged.content?.primarySubjects?.map((item) => item.name)).toEqual(['熊猫', '皮球'])
    expect(merged.content?.actionOrRelationship).toBe('坐在地上抱着红色皮球')
  })
})

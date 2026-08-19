import { describe, expect, it } from 'vitest'
import { createEmptyGenerationSpec, validateGenerationSpec } from '../../src/shared/contracts'
import type { CreationIntentParser } from '../../src/shared/creation-intent'
import {
  applyDecideForMe,
  applyGenerationSpecPatch,
  decideClarification,
  evaluateGenerationSpecCompleteness,
  FallbackCreationIntentParser,
  LocalCreationIntentParser,
  lockAssetRole,
  mergeGenerationSpecPatches,
  patchHasContent,
  RemoteCreationIntentParser,
  resolveAssetRoleFromText,
  sanitizeGenerationSpecPatch
} from '../../src/shared/creation-intent'

describe('asset role resolver', () => {
  it('locks an explicit entry and classifies common Chinese intents', () => {
    expect(lockAssetRole('background')).toEqual({ role: 'background', confidence: 'high' })
    expect(resolveAssetRoleFromText('做一个庭院背景').role).toBe('background')
    expect(resolveAssetRoleFromText('给我一个可以自己摆的灯笼').role).toBe('element')
    expect(resolveAssetRoleFromText('兔子抱月饼').role).toBe('core_pattern')
    expect(resolveAssetRoleFromText('做一个中秋场景').role).toBeNull()
    expect(resolveAssetRoleFromText('做一个中秋场景').confidence).toBe('low')
  })
})

describe('GenerationSpec patch and completeness', () => {
  it('merges content patches without wiping the role or copying Prompt fields', () => {
    const base = createEmptyGenerationSpec('core_pattern')
    const next = applyGenerationSpecPatch(base, {
      content: { primarySubjects: [{ name: '玉兔' }] },
      prompt: 'detailed fur',
      provider: 'wan'
    } as never)
    expect(next.assetRole).toBe('core_pattern')
    expect(next.content.primarySubjects).toEqual([{ name: '玉兔' }])
    expect(next).not.toHaveProperty('prompt')
    expect(next).not.toHaveProperty('provider')
    expect(validateGenerationSpec(next).ok).toBe(true)

    const colored = applyGenerationSpecPatch(next, { content: { preferredColors: ['白色'] } })
    expect(colored.content.primarySubjects).toEqual([{ name: '玉兔' }])
    expect(colored.content.preferredColors).toEqual(['白色'])
  })

  it('stacks a posture supplement onto an existing holding action', () => {
    const holding = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), {
      content: {
        primarySubjects: [
          { name: '熊猫', attributes: ['黑白'] },
          { name: '皮球', attributes: ['红色'] }
        ],
        actionOrRelationship: '抱着皮球'
      }
    })
    const stacked = applyGenerationSpecPatch(holding, {
      content: { primarySubjects: [{ name: '熊猫' }], actionOrRelationship: '坐在地上' }
    })
    expect(stacked.content.primarySubjects.map((item) => item.name)).toEqual(['熊猫', '皮球'])
    expect(stacked.content.actionOrRelationship).toBe('坐在地上抱着皮球')

    const spoken = applyGenerationSpecPatch(holding, {
      content: { actionOrRelationship: '这个熊猫坐在地上' }
    })
    expect(spoken.content.actionOrRelationship).toBe('坐在地上抱着皮球')
  })

  it('treats a missing subject as a critical gap for core_pattern and element', () => {
    const emptyCore = createEmptyGenerationSpec('core_pattern')
    expect(evaluateGenerationSpecCompleteness(emptyCore).status).toBe('NEEDS_CLARIFICATION')
    expect(evaluateGenerationSpecCompleteness(emptyCore).criticalFields).toContain('content.primarySubjects')

    const filled = applyGenerationSpecPatch(emptyCore, {
      content: {
        primarySubjects: [{ name: '荷花', attributes: ['粉色'] }],
        actionOrRelationship: '漂在水上'
      }
    })
    expect(evaluateGenerationSpecCompleteness(filled).status).toBe('READY_TO_CONFIRM')
  })

  it('asks one clarification question per round and stops at the hard cap for critical gaps', () => {
    const empty = createEmptyGenerationSpec('element')
    const first = decideClarification(empty)
    expect(first.status).toBe('NEEDS_CLARIFICATION')
    expect(first.question?.field).toBe('content.primarySubjects')
    expect(first.spec.clarification.roundCount).toBe(1)

    let current = first.spec
    for (let round = 2; round <= 5; round += 1) {
      const next = decideClarification(current)
      expect(next.status).toBe('NEEDS_CLARIFICATION')
      expect(next.spec.clarification.roundCount).toBe(round)
      current = next.spec
    }

    const sixth = decideClarification(current)
    expect(sixth.status).toBe('USE_DEFAULTS')
    expect(sixth.question).toBeNull()

    const decided = applyDecideForMe(first.spec)
    expect(decided.clarification.pendingField).toBeNull()
    expect(decided.clarification.roundCount).toBeGreaterThanOrEqual(5)
    const afterDecide = decideClarification(decided)
    expect(afterDecide.status).toBe('USE_DEFAULTS')
    expect(afterDecide.question).toBeNull()
  })

  it('asks for an action when only the subject is known, then uses defaults after soft-round cap', () => {
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), {
      content: { primarySubjects: [{ name: '玉兔' }] }
    })
    expect(evaluateGenerationSpecCompleteness(spec).status).toBe('NEEDS_CLARIFICATION')
    expect(evaluateGenerationSpecCompleteness(spec).missingFields).toContain('content.actionOrRelationship')

    const first = decideClarification(spec)
    expect(first.status).toBe('NEEDS_CLARIFICATION')
    expect(first.question?.field).toBe('content.actionOrRelationship')

    spec.clarification.roundCount = 4
    const decision = decideClarification(spec)
    expect(decision.status).toBe('USE_DEFAULTS')
    expect(decision.question).toBeNull()
  })

  it('asks for colors when subjects and action are known but no color was said', () => {
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), {
      content: {
        primarySubjects: [{ name: '熊猫' }, { name: '皮球' }],
        actionOrRelationship: '坐在地上抱着皮球'
      }
    })
    expect(evaluateGenerationSpecCompleteness(spec).missingFields).toContain('content.preferredColors')
    const decision = decideClarification(spec)
    expect(decision.question?.field).toBe('content.preferredColors')
  })

  it('treats a missing place as a critical gap for background', () => {
    const empty = createEmptyGenerationSpec('background')
    expect(evaluateGenerationSpecCompleteness(empty).criticalFields).toContain(
      'content.environmentDescription'
    )
    const filled = applyGenerationSpecPatch(empty, {
      content: { environmentDescription: '中秋庭院' }
    })
    expect(evaluateGenerationSpecCompleteness(filled).status).toBe('READY_TO_CONFIRM')
  })
})

describe('CreationIntentParser boundary', () => {
  it('lets a parser return only a domain patch, never a Prompt', async () => {
    const parser: CreationIntentParser = {
      async parse({ text, lockedRole }) {
        return {
          assetRole: lockedRole ?? 'core_pattern',
          content: { primarySubjects: [{ name: text.slice(0, 8) }] }
        }
      }
    }
    const patch = await parser.parse({ text: '玉兔抱月饼', lockedRole: 'core_pattern' })
    expect(patch).not.toHaveProperty('prompt')
    expect(patch).not.toHaveProperty('provider')
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), patch)
    expect(validateGenerationSpec(spec).ok).toBe(true)
    expect(spec.content.primarySubjects[0]?.name).toBe('玉兔抱月饼')
  })
})

describe('LocalCreationIntentParser', () => {
  const parser = new LocalCreationIntentParser()

  it('fills a core pattern from a short Chinese sentence', async () => {
    const patch = await parser.parse({ text: '白色玉兔抱月饼，不要真实毛发' })
    expect(patch).not.toHaveProperty('prompt')
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), patch)
    expect(spec.assetRole).toBe('core_pattern')
    expect(spec.content.primarySubjects).toEqual([
      { name: '玉兔', attributes: ['白色'] },
      { name: '月饼' }
    ])
    expect(spec.content.preferredColors).toBeUndefined()
    expect(spec.content.actionOrRelationship).toContain('抱')
    expect(spec.content.forbiddenElements).toEqual(['真实毛发'])
    expect(validateGenerationSpec(spec).ok).toBe(true)
    expect(evaluateGenerationSpecCompleteness(spec).status).toBe('READY_TO_CONFIRM')
  })

  it('attaches nearby colors to each subject separately', async () => {
    const patch = await parser.parse({ text: '黑白熊猫抱着红色皮球' })
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), patch)
    expect(spec.content.primarySubjects).toEqual([
      { name: '熊猫', attributes: ['黑白'] },
      { name: '皮球', attributes: ['红色'] }
    ])
    expect(spec.content.preferredColors).toBeUndefined()
  })

  it('remembers a held ball together with sit-and-hold wording', async () => {
    const patch = await parser.parse({ text: '一只熊猫坐在地上抱着皮球' })
    const spec = applyGenerationSpecPatch(createEmptyGenerationSpec('core_pattern'), patch)
    expect(spec.content.primarySubjects.map((item) => item.name)).toEqual(['熊猫', '皮球'])
    expect(spec.content.actionOrRelationship).toBe('坐在地上抱着皮球')
    expect(evaluateGenerationSpecCompleteness(spec).status).toBe('NEEDS_CLARIFICATION')
    expect(evaluateGenerationSpecCompleteness(spec).missingFields).toContain('content.preferredColors')
  })

  it('fills an independent lantern and a courtyard background', async () => {
    const lantern = applyGenerationSpecPatch(
      createEmptyGenerationSpec('element'),
      await parser.parse({ text: '给我一个可以自己摆的灯笼', lockedRole: 'element' })
    )
    expect(lantern.assetRole).toBe('element')
    expect(lantern.content.primarySubjects[0]?.name).toBe('灯笼')

    const courtyard = applyGenerationSpecPatch(
      createEmptyGenerationSpec('background'),
      await parser.parse({ text: '做一个庭院背景' })
    )
    expect(courtyard.assetRole).toBe('background')
    expect(courtyard.content.environmentDescription).toContain('庭院')
    expect(evaluateGenerationSpecCompleteness(courtyard).status).toBe('READY_TO_CONFIRM')
  })
})

describe('sanitizeGenerationSpecPatch', () => {
  it('strips Prompt/Provider fields and bounds names', () => {
    const patch = sanitizeGenerationSpecPatch(
      {
        assetRole: 'element',
        prompt: 'a photorealistic rabbit',
        provider: 'wan',
        content: {
          primarySubjects: [{ name: '穿蓝色裙子的小猫咪超级长名字要截断', attributes: ['蓝色'] }],
          actionOrRelationship: '在草地上轻轻追着蝴蝶飞来飞去还回头笑',
          preferredColors: ['蓝色']
        }
      },
      'core_pattern'
    )
    expect(patch.assetRole).toBe('core_pattern')
    expect(patch).not.toHaveProperty('prompt')
    expect(patch).not.toHaveProperty('provider')
    expect(patch.content?.primarySubjects?.[0]?.name).toHaveLength(16)
    expect(patch.content?.actionOrRelationship?.length).toBeLessThanOrEqual(40)
    expect(patchHasContent(patch)).toBe(true)

    const merged = mergeGenerationSpecPatches(
      { content: { primarySubjects: [{ name: '蝴蝶' }] } },
      patch
    )
    expect(merged.content?.primarySubjects?.map((item) => item.name)).toEqual([
      '蝴蝶',
      patch.content?.primarySubjects?.[0]?.name
    ])
  })
})

describe('FallbackCreationIntentParser', () => {
  it('uses local rules when the LLM is empty or throws', async () => {
    const local = new LocalCreationIntentParser()

    const emptyLlm = new FallbackCreationIntentParser({
      primary: { parse: async () => ({}) },
      fallback: local
    })
    const fromEmpty = await emptyLlm.parse({
      text: '白色玉兔抱月饼，不要真实毛发',
      lockedRole: 'core_pattern'
    })
    expect(fromEmpty.content?.primarySubjects?.map((item) => item.name)).toEqual(['玉兔', '月饼'])

    const throwing = new FallbackCreationIntentParser({
      primary: {
        parse: async () => {
          throw new Error('offline')
        }
      },
      fallback: local
    })
    const fromThrow = await throwing.parse({ text: '一只熊猫坐在地上抱着皮球', lockedRole: 'core_pattern' })
    expect(fromThrow.content?.primarySubjects?.map((item) => item.name)).toEqual(['熊猫', '皮球'])
  })

  it('lets the LLM add a subject the local dictionary missed', async () => {
    const parser = new FallbackCreationIntentParser({
      fallback: new LocalCreationIntentParser(),
      primary: new RemoteCreationIntentParser(async () => ({
        ok: true,
        result: {
          patch: {
            prompt: 'should be stripped',
            content: {
              primarySubjects: [{ name: '小猫', attributes: ['蓝色'] }, { name: '蝴蝶' }],
              actionOrRelationship: '追蝴蝶'
            }
          }
        }
      }))
    })
    const patch = await parser.parse({ text: '一只蓝衣服小猫追蝴蝶', lockedRole: 'core_pattern' })
    expect(patch).not.toHaveProperty('prompt')
    expect(patch.content?.primarySubjects?.map((item) => item.name)).toEqual(['蝴蝶', '小猫'])
    expect(patch.content?.actionOrRelationship).toBe('追蝴蝶')
  })
})

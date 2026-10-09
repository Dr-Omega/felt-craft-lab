import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CreationIntentHost } from '../../src/main/creation-intent/host'
import {
  CREATION_ASSET_ROLE,
  CreationIntentController,
  summarizeCreationSpec,
  type CreationIntentUiClient
} from '../../src/renderer/src/services/creation-intent.controller'
import {
  ASR_EMPTY_VOICE_MESSAGE,
  blobToBase64,
  parseAsrEnvelope
} from '../../src/renderer/src/services/voice-input'
import { createSceneWithCorePattern } from '../../src/renderer/src/catalog/ywn-catalog'
import { createEmptyGenerationSpec } from '../../src/shared/contracts'

function clientFor(host: CreationIntentHost): CreationIntentUiClient {
  return {
    start: async (input) => host.start(input),
    submitText: (input) => host.submit(input),
    confirm: async (input) => host.confirm(input),
    decideForMe: async (input) => host.decideForMe(input),
    regenerate: async (input) => host.regenerate(input),
    accept: async (input) => host.accept(input)
  }
}

describe('CreateAssetPage surface', () => {
  const page = readFileSync(resolve('src/renderer/src/pages/CreateAssetPage.vue'), 'utf8')
  const app = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')

  it('only generates a core pattern; speech is written in then remembered', () => {
    expect(app).toContain('生成作品')
    expect(page).toContain('先画出核心图案')
    expect(page).toContain('去编辑器装饰')
    expect(page).toContain('fromGeneration: true')
    expect(page).not.toContain('用这张做作品')
    expect(page).toContain('就这样画')
    expect(page).toContain('你来定')
    expect(page).toContain('decideForMe')
    expect(page).toContain('开始说话')
    expect(page).toContain('现在记下的方案')
    expect(page).toContain('plan.fields')
    expect(page).toContain('showPlanCard')
    expect(page).toContain('还没说')
    expect(page).toContain('正在问这栏')
    expect(page).toContain('临时预览')
    expect(page).toContain('candidateRef')
    expect(page).toContain('busyHint')
    expect(page).toContain('redrawCandidate')
    expect(page).toContain('再画一张')
    expect(page).toContain('重新说')
    expect(page).toContain('createSceneWithCorePattern')
    expect(page).toContain('startWork')
    expect(page).toContain('qualityHeadline')
    expect(page).toContain('create-guide')
    expect(page).toContain('再试一次')
    expect(page).toContain('retryLastFailure')
    expect(page).toContain('仍可以点「确认图片并开始拆分」')
    expect(page).not.toContain('画图说明')
    expect(page).not.toContain('不要出现')
    expect(page).not.toContain('positiveText')
    expect(page).not.toContain('negativeText')
    expect((page.match(/<script setup lang="ts">/g) ?? []).length).toBe(1)
    expect(page).not.toContain('云端生图还没接上')
    expect(page).not.toContain('开始记下来')
    expect(page).not.toContain('这次画哪种')
    expect(page).not.toContain('可以摆的小物件')
    expect(page).not.toContain('收下这张')
    expect(page).not.toContain('用到作品里')
    expect(page).not.toContain('进素材库')
    expect(page).not.toContain('个人素材库')
    expect(page.toLowerCase()).not.toContain('provider')
    expect(page).not.toContain('sessionId')
    expect(page).toContain('create-scroll')
    expect(page).toContain('overflow-y: scroll')
  })

  it('places an accepted core into a new editor scene', () => {
    const personalAssetId = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
    const versionId = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
    const scene = createSceneWithCorePattern({
      workName: '玉兔和月饼',
      personalAssetId,
      versionId
    })
    expect(scene.workName).toBe('玉兔和月饼')
    expect(scene.corePattern).toMatchObject({
      personalAssetId,
      versionId,
      visible: true,
      locked: false
    })
    expect(scene.personalElements).toEqual([])
    expect(scene.personalBackground).toBeNull()
  })
})

describe('voice transcript parsing', () => {
  it('fills trimmed speech and rejects empty recognition', () => {
    expect(
      parseAsrEnvelope({
        ok: true,
        result: { transcript: '  白色玉兔抱月饼  ', provider: 'qwen_cloud_http', durationMs: 12 }
      })
    ).toEqual({ ok: true, transcript: '白色玉兔抱月饼' })
    expect(parseAsrEnvelope({ ok: false, error: { code: 'ASR_EMPTY_TRANSCRIPT', message: '空', retryable: false } })).toEqual({
      ok: false,
      message: ASR_EMPTY_VOICE_MESSAGE,
      reason: 'empty'
    })
  })

  it('encodes captured audio as base64', async () => {
    const encoded = await blobToBase64(new Blob([Uint8Array.from([1, 2, 3])]))
    expect(encoded).toBe(btoa(String.fromCharCode(1, 2, 3)))
  })
})

describe('CreationIntentController', () => {
  it('summarizes subjects and action without Prompt fields', () => {
    const spec = createEmptyGenerationSpec('core_pattern')
    spec.content.primarySubjects = [{ name: '玉兔', attributes: ['白色'] }, { name: '月饼' }]
    spec.content.actionOrRelationship = '抱'
    expect(summarizeCreationSpec(spec)).toBe('白色玉兔，月饼，抱')
  })

  it('binds colors to each subject and stacks action supplements', async () => {
    const host = new CreationIntentHost({
      createId: () => '55555555-5555-4555-8555-555555555555',
      now: () => '2026-08-18T14:22:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: 'felt-resource://preview/gen55555555555545558555555555555555.png' })
    })
    const controller = new CreationIntentController(clientFor(host))
    await controller.acceptUtterance('黑白熊猫抱着红色皮球')
    expect(controller.plan.subjectLines).toEqual(['黑白熊猫', '红色皮球'])
    expect(controller.plan.action).toContain('抱')
    expect(controller.plan.extraColors).toBe('')
    expect(controller.text).toBe('')

    await controller.acceptUtterance('坐在地上')
    expect(controller.phase).toBe('ready_to_confirm')
    expect(controller.plan.subjectLines).toEqual(['黑白熊猫', '红色皮球'])
    expect(controller.plan.action).toBe('坐在地上抱着红色皮球')
  })

  it('redraws a new candidate without resetting the confirmed plan', async () => {
    const refs = [
      'felt-resource://preview/genaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      'felt-resource://preview/genbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
    ]
    let saveIndex = 0
    const host = new CreationIntentHost({
      createId: (() => {
        const ids = [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:22:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: refs[saveIndex++] ?? refs[0] })
    })
    const controller = new CreationIntentController(clientFor(host))
    await controller.acceptUtterance('白色玉兔抱月饼，不要真实毛发')
    await controller.confirmPlan()
    expect(controller.candidateRef).toBe(refs[0])
    const planBefore = controller.summary
    await controller.redrawCandidate()
    expect(controller.candidateRef).toBe(refs[1])
    expect(controller.summary).toBe(planBefore)
    expect(controller.phase).toBe('generated')
  })

  it('locks generation to core_pattern and remembers each spoken supplement', async () => {
    const host = new CreationIntentHost({
      createId: () => '55555555-5555-4555-8555-555555555555',
      now: () => '2026-08-18T14:22:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: 'felt-resource://preview/gen55555555555545558555555555555555.png' })
    })
    const controller = new CreationIntentController(clientFor(host))
    expect(controller.role).toBe(CREATION_ASSET_ROLE)
    await controller.acceptUtterance('白色玉兔抱月饼，不要真实毛发')
    expect(controller.text).toBe('')
    expect(controller.phase).toBe('ready_to_confirm')
    expect(controller.summary).toContain('玉兔')

    await controller.acceptUtterance('再加一个灯笼')
    expect(controller.phase).toBe('ready_to_confirm')
    expect(controller.summary).toContain('灯笼')
    expect(controller.summary).toContain('玉兔')

    await controller.confirmPlan()
    expect(controller.phase).toBe('generated')
    expect(controller.positiveText).toContain('简单可爱卡通平面大色块')
    expect(controller.candidateRef).toContain('felt-resource://preview/')
    expect(controller.quality?.verdict).toBe('PASS')
    expect(controller.canAccept).toBe(true)
  })

  it('offers retry after a failed confirm', async () => {
    const host = new CreationIntentHost({
      createId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      now: () => '2026-08-18T14:22:00.000Z',
      saveTemporaryPng: () => {
        throw new Error('暂时画不出来')
      }
    })
    const controller = new CreationIntentController(clientFor(host))
    await controller.acceptUtterance('白色玉兔抱月饼，不要真实毛发')
    await controller.confirmPlan()
    expect(controller.error).toContain('暂时画不出来')
    expect(controller.canRetry).toBe(true)
    expect(controller.retryAction).toBe('confirm')
    await controller.retryLastFailure()
    expect(controller.retryAction).toBe('confirm')
    expect(controller.error).toBeTruthy()
  })

  it('persists an accepted candidate, including FAIL quality core patterns', async () => {
    const previewRef = 'felt-resource://preview/gen88888888888848888888888888888888.png'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const persisted: string[] = []
    const host = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '88888888-8888-4888-8888-888888888888',
          '88888888-8888-4888-8888-888888888881',
          '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1',
          '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:22:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: previewRef }),
      readTemporaryPng: (ref) => {
        expect(ref).toBe(previewRef)
        return { ok: true, bytes: png }
      },
      ingestPersonalPng: ({ personalAssetId, versionId, pngBytes }) => {
        expect(pngBytes[0]).toBe(0x89)
        return {
          ok: true,
          ref: `felt-resource://personal/${personalAssetId}/${versionId}/source.png`
        }
      }
    })
    const controller = new CreationIntentController(clientFor(host), async (accepted) => {
      persisted.push(accepted.personalAssetId)
    })
    await controller.acceptUtterance('白色玉兔抱月饼，不要真实毛发')
    await controller.confirmPlan()
    await controller.acceptCandidate()
    expect(controller.phase).toBe('accepted')
    expect(controller.accepted?.name).toContain('玉兔')
    expect(controller.canAccept).toBe(false)
    expect(persisted).toEqual(['8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'])

    const failHost = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '99999999-9999-4999-8999-999999999999',
          '99999999-9999-4999-8999-999999999991',
          '7b3a9d6e-9b80-4f4f-9c47-44ef1e910f35',
          'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:22:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: previewRef }),
      generatePng: async () => ({
        bytes: png,
        width: 512,
        height: 512,
        quality: { verdict: 'FAIL', messages: ['颜色种类太多，不适合剪不织布。'] }
      }),
      readTemporaryPng: () => ({ ok: true, bytes: png }),
      ingestPersonalPng: ({ personalAssetId, versionId }) => ({
        ok: true,
        ref: `felt-resource://personal/${personalAssetId}/${versionId}/source.png`
      })
    })
    const warned = new CreationIntentController(clientFor(failHost), async (accepted) => {
      persisted.push(accepted.personalAssetId)
    })
    await warned.acceptUtterance('白色玉兔抱月饼，不要真实毛发')
    await warned.confirmPlan()
    expect(warned.quality?.verdict).toBe('FAIL')
    expect(warned.canAccept).toBe(true)
    await warned.acceptCandidate()
    expect(warned.accepted?.personalAssetId).toBe('7b3a9d6e-9b80-4f4f-9c47-44ef1e910f35')
  })

  it('asks a follow-up when the first sentence has no subject', async () => {
    const host = new CreationIntentHost({
      createId: () => '66666666-6666-4666-8666-666666666666',
      now: () => '2026-08-18T14:22:00.000Z'
    })
    const controller = new CreationIntentController(clientFor(host))
    controller.text = '给我一个可以自己摆的'
    await controller.submitCurrentText()
    expect(controller.phase).toBe('awaiting_clarification')
    expect(controller.question).toContain('最想画')
    expect(controller.plan.fields).toHaveLength(6)
    expect(controller.plan.fields.every((field) => field.label)).toBe(true)

    controller.text = '玉兔'
    await controller.submitCurrentText()
    expect(controller.phase).toBe('awaiting_clarification')
    expect(controller.question).toContain('做什么')

    controller.text = '抱着月饼'
    await controller.submitCurrentText()
    expect(controller.phase).toBe('awaiting_clarification')
    expect(controller.question).toContain('颜色')

    controller.text = '白色'
    await controller.submitCurrentText()
    expect(controller.phase).toBe('ready_to_confirm')
    expect(controller.plan.subjectLines.some((line) => line.includes('玉兔'))).toBe(true)
    expect(controller.plan.action).toContain('抱')
    expect(controller.plan.fields.find((field) => field.key === 'content.preferredColors')?.value).toContain(
      '白色'
    )
  })

  it('asks what it is doing when only the subject is spoken', async () => {
    const host = new CreationIntentHost({
      createId: () => '77777777-7777-4777-8777-777777777777',
      now: () => '2026-08-18T14:22:00.000Z'
    })
    const controller = new CreationIntentController(clientFor(host))
    await controller.acceptUtterance('一只玉兔')
    expect(controller.phase).toBe('awaiting_clarification')
    expect(controller.question).toContain('做什么')
    expect(controller.choices).toContain('抱着月饼')
    expect(controller.hasPlan).toBe(true)
    expect(controller.plan.fields.find((field) => field.key === 'content.actionOrRelationship')?.status).toBe(
      'pending'
    )
  })

  it('lets the child skip remaining questions with decideForMe', async () => {
    const host = new CreationIntentHost({
      createId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      now: () => '2026-08-18T14:22:00.000Z'
    })
    const controller = new CreationIntentController(clientFor(host))
    await controller.acceptUtterance('一只玉兔')
    expect(controller.phase).toBe('awaiting_clarification')

    await controller.decideForMe()
    expect(controller.phase).toBe('ready_to_confirm')
    expect(controller.question).toBeNull()
    expect(controller.plan.subjectLines.some((line) => line.includes('玉兔'))).toBe(true)
  })
})

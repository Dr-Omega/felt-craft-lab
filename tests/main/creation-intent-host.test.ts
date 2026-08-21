import { describe, expect, it } from 'vitest'
import { CreationIntentHost } from '../../src/main/creation-intent/host'
import { MAX_CREATION_INTENT_SESSIONS } from '../../src/shared/creation-intent'

function hostWithIds(ids: string[], save = false): CreationIntentHost {
  let index = 0
  return new CreationIntentHost({
    createId: () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    now: () => '2026-08-18T14:08:00.000Z',
    saveTemporaryPng: save
      ? (bytes) => {
          expect(bytes[0]).toBe(0x89)
          return { ok: true, ref: 'felt-resource://preview/gen11111111111141118111111111111111.png' }
        }
      : undefined
  })
}

describe('CreationIntentHost IPC', () => {
  it('starts, submits, and confirms into a Canonical Prompt without Provider fields', async () => {
    const host = hostWithIds(['11111111-1111-4111-8111-111111111111'], true)
    const started = host.start({ lockedRole: 'core_pattern' })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const submitted = await host.submit({
      sessionId: started.sessionId,
      text: '白色玉兔抱月饼，不要真实毛发'
    })
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    expect(submitted.snapshot.phase).toBe('ready_to_confirm')
    expect(submitted.snapshot.prompt).toBeNull()

    const confirmed = await host.confirm({ sessionId: started.sessionId })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.snapshot.phase).toBe('generated')
    expect(confirmed.snapshot.prompt?.positiveText).toContain('平面大色块')
    expect(confirmed.snapshot.candidate?.temporaryRef).toBe(
      'felt-resource://preview/gen11111111111141118111111111111111.png'
    )
    expect(confirmed.snapshot.candidate?.status).toBe('REVIEWABLE')
    expect(JSON.stringify(confirmed)).not.toMatch(/provider|apiKey|minimax|qwen-image/i)
  })

  it('ingests an accepted preview into a personal source.png even when quality is FAIL', async () => {
    const previewRef = 'felt-resource://preview/gen11111111111141118111111111111111.png'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const ingested: Array<{ personalAssetId: string; versionId: string }> = []
    const host = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111112',
          '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1',
          '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:08:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: previewRef }),
      readTemporaryPng: (ref) => {
        expect(ref).toBe(previewRef)
        return { ok: true, bytes: png }
      },
      ingestPersonalPng: (input) => {
        ingested.push({ personalAssetId: input.personalAssetId, versionId: input.versionId })
        return {
          ok: true,
          ref: `felt-resource://personal/${input.personalAssetId}/${input.versionId}/source.png`
        }
      }
    })
    const started = host.start({ lockedRole: 'core_pattern' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await host.submit({ sessionId: started.sessionId, text: '白色玉兔抱月饼，不要真实毛发' })
    await host.confirm({ sessionId: started.sessionId })
    const accepted = await host.accept({ sessionId: started.sessionId })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(accepted.snapshot.phase).toBe('accepted')
    expect(accepted.snapshot.candidate?.status).toBe('ACCEPTED')
    expect(accepted.accepted).toEqual({
      personalAssetId: '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1',
      versionId: '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a',
      sourceImageRef:
        'felt-resource://personal/8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1/3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a/source.png',
      name: '玉兔和月饼',
      role: 'core_pattern'
    })
    expect(ingested).toHaveLength(1)

    const again = await host.accept({ sessionId: started.sessionId })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.accepted?.personalAssetId).toBe(accepted.accepted?.personalAssetId)
    expect(ingested).toHaveLength(1)

    const failHost = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '22222222-2222-4222-8222-222222222222',
          '22222222-2222-4222-8222-222222222221',
          '7b3a9d6e-9b80-4f4f-9c47-44ef1e910f35',
          'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:08:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: previewRef }),
      generatePng: async () => ({
        bytes: png,
        width: 512,
        height: 512,
        quality: { verdict: 'FAIL', messages: ['颜色种类太多，不适合剪不织布。'] }
      }),
      readTemporaryPng: () => ({ ok: true, bytes: png }),
      ingestPersonalPng: (input) => ({
        ok: true,
        ref: `felt-resource://personal/${input.personalAssetId}/${input.versionId}/source.png`
      })
    })
    const failStarted = failHost.start({ lockedRole: 'core_pattern' })
    expect(failStarted.ok).toBe(true)
    if (!failStarted.ok) return
    await failHost.submit({ sessionId: failStarted.sessionId, text: '白色玉兔抱月饼，不要真实毛发' })
    const confirmed = await failHost.confirm({ sessionId: failStarted.sessionId })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.snapshot.candidate?.status).toBe('QUALITY_CHECKED')
    const used = await failHost.accept({ sessionId: failStarted.sessionId })
    expect(used.ok).toBe(true)
    if (!used.ok) return
    expect(used.accepted?.role).toBe('core_pattern')
  })

  it('rejects Prompt pollution, empty text, and unknown sessions', async () => {
    const host = hostWithIds(['22222222-2222-4222-8222-222222222222'])
    expect(host.start({ prompt: 'cinematic lighting' } as never).ok).toBe(false)

    const started = host.start({})
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(
      (
        await host.submit({
          sessionId: started.sessionId,
          text: '玉兔',
          provider: 'wan'
        } as never)
      ).ok
    ).toBe(false)
    expect((await host.submit({ sessionId: started.sessionId, text: '   ' })).ok).toBe(false)
    expect((await host.confirm({ sessionId: '33333333-3333-4333-8333-333333333333' })).ok).toBe(false)
  })

  it('keeps renderer snapshots from mutating Main session state', async () => {
    const host = hostWithIds(['44444444-4444-4444-8444-444444444444'])
    const started = host.start({ lockedRole: 'element' })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const submitted = await host.submit({ sessionId: started.sessionId, text: '灯笼' })
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    submitted.snapshot.spec.content.primarySubjects[0].name = '被前端改掉了'

    const snapshot = host.snapshot({ sessionId: started.sessionId })
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.snapshot.spec.content.primarySubjects[0]?.name).toBe('灯笼')
  })

  it('caps stored sessions', () => {
    const ids = Array.from({ length: MAX_CREATION_INTENT_SESSIONS + 1 }, (_, index) => {
      const n = String(index + 1).padStart(12, '0')
      return `aaaaaaaa-aaaa-4aaa-8aaa-${n}`
    })
    const host = hostWithIds(ids)
    const first = host.start({})
    expect(first.ok).toBe(true)
    if (!first.ok) return
    for (let i = 0; i < MAX_CREATION_INTENT_SESSIONS; i += 1) {
      expect(host.start({}).ok).toBe(true)
    }
    expect(host.snapshot({ sessionId: first.sessionId }).ok).toBe(false)
  })

  it('deletes old preview on successful regenerate, keeps it when regenerate fails', async () => {
    const deleted: string[] = []
    const refs = [
      'felt-resource://preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      'felt-resource://preview/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
    ]
    let saveIndex = 0
    const host = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '55555555-5555-4555-8555-555555555551',
          '55555555-5555-4555-8555-555555555552',
          '55555555-5555-4555-8555-555555555553'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:08:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: refs[Math.min(saveIndex++, refs.length - 1)] }),
      deleteTemporaryPng: (ref) => {
        deleted.push(ref)
        return { ok: true }
      },
      generatePng: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    })
    const started = host.start({ lockedRole: 'core_pattern' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await host.submit({ sessionId: started.sessionId, text: '白色玉兔抱月饼，不要真实毛发' })
    const confirmed = await host.confirm({ sessionId: started.sessionId })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.snapshot.candidate?.temporaryRef).toBe(refs[0])

    const redrawn = await host.regenerate({ sessionId: started.sessionId })
    expect(redrawn.ok).toBe(true)
    if (!redrawn.ok) return
    expect(redrawn.snapshot.candidate?.temporaryRef).toBe(refs[1])
    expect(deleted).toContain(refs[0])

    let calls = 0
    const kept: string[] = []
    const flaky = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '77777777-7777-4777-8777-777777777771',
          '77777777-7777-4777-8777-777777777772',
          '77777777-7777-4777-8777-777777777773'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:08:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: refs[0] }),
      deleteTemporaryPng: (ref) => {
        kept.push(ref)
        return { ok: true }
      },
      generatePng: async () => {
        calls += 1
        if (calls === 1) return Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
        throw new Error('provider down')
      }
    })
    const okStart = flaky.start({ lockedRole: 'core_pattern' })
    expect(okStart.ok).toBe(true)
    if (!okStart.ok) return
    await flaky.submit({ sessionId: okStart.sessionId, text: '白色玉兔抱月饼，不要真实毛发' })
    await flaky.confirm({ sessionId: okStart.sessionId })
    const failed = await flaky.regenerate({ sessionId: okStart.sessionId })
    expect(failed.ok).toBe(false)
    const after = flaky.snapshot({ sessionId: okStart.sessionId })
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.snapshot.candidate?.temporaryRef).toBe(refs[0])
    expect(kept).not.toContain(refs[0])
  })

  it('deletes preview after accept and when sessions are evicted', async () => {
    const deleted: string[] = []
    const previewRef = 'felt-resource://preview/cccccccccccccccccccccccccccccccc.png'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const host = new CreationIntentHost({
      createId: (() => {
        const ids = [
          '88888888-8888-4888-8888-888888888881',
          '88888888-8888-4888-8888-888888888882',
          '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1',
          '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
        ]
        let index = 0
        return () => ids[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      })(),
      now: () => '2026-08-18T14:08:00.000Z',
      saveTemporaryPng: () => ({ ok: true, ref: previewRef }),
      deleteTemporaryPng: (ref) => {
        deleted.push(ref)
        return { ok: true }
      },
      readTemporaryPng: () => ({ ok: true, bytes: png }),
      ingestPersonalPng: (input) => ({
        ok: true,
        ref: `felt-resource://personal/${input.personalAssetId}/${input.versionId}/source.png`
      })
    })
    const started = host.start({ lockedRole: 'core_pattern' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await host.submit({ sessionId: started.sessionId, text: '白色玉兔抱月饼，不要真实毛发' })
    await host.confirm({ sessionId: started.sessionId })
    const accepted = await host.accept({ sessionId: started.sessionId })
    expect(accepted.ok).toBe(true)
    expect(deleted).toContain(previewRef)

    deleted.length = 0
    const evictionIds = Array.from({ length: MAX_CREATION_INTENT_SESSIONS + 1 }, (_, index) => {
      const n = String(index + 1).padStart(12, '0')
      return `bbbbbbbb-bbbb-4bbb-8bbb-${n}`
    })
    let saveN = 0
    const evictionHost = new CreationIntentHost({
      createId: () => evictionIds[saveN++] ?? `00000000-0000-4000-8000-${String(saveN).padStart(12, '0')}`,
      now: () => '2026-08-18T14:08:00.000Z',
      saveTemporaryPng: () => ({
        ok: true,
        ref: `felt-resource://preview/${String(saveN).padStart(32, 'a')}.png`
      }),
      deleteTemporaryPng: (ref) => {
        deleted.push(ref)
        return { ok: true }
      }
    })
    const first = evictionHost.start({ lockedRole: 'core_pattern' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await evictionHost.submit({ sessionId: first.sessionId, text: '白色玉兔抱月饼，不要真实毛发' })
    await evictionHost.confirm({ sessionId: first.sessionId })
    const firstRef = evictionHost.snapshot({ sessionId: first.sessionId })
    expect(firstRef.ok).toBe(true)
    if (!firstRef.ok) return
    const doomed = firstRef.snapshot.candidate?.temporaryRef
    expect(doomed).toBeTruthy()
    for (let i = 0; i < MAX_CREATION_INTENT_SESSIONS; i += 1) {
      expect(evictionHost.start({}).ok).toBe(true)
    }
    expect(evictionHost.snapshot({ sessionId: first.sessionId }).ok).toBe(false)
    expect(deleted).toContain(doomed)
  })

  it('returns QA_BLOCKED from submit when the parser blocks the utterance', async () => {
    const { CreationIntentBlockedError } = await import('../../src/shared/creation-intent')
    const host = new CreationIntentHost({
      createId: () => '99999999-9999-4999-8999-999999999999',
      parser: {
        parse: async () => {
          throw new CreationIntentBlockedError()
        }
      }
    })
    const started = host.start({ lockedRole: 'core_pattern' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const blocked = await host.submit({ sessionId: started.sessionId, text: '炸弹' })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error.code).toBe('QA_BLOCKED')
  })
})

import { describe, expect, it } from 'vitest'
import { LearningHost, learningFailure } from '../../src/main/learning/host'
import catalog from '../../src/renderer/src/catalog/assets.manifest.json'
import { listLevels } from '../../sticker-game-backend/src/levels.js'

function sceneFor(session: any) {
  return { schemaVersion: 2, sceneId: crypto.randomUUID(), userId: 'user-1', workName: '引导任务', themeId: session.level.themeId,
    assetSnapshotId: catalog.assetSnapshotId, canvas: { width: session.level.canvasBounds.maxX - session.level.canvasBounds.minX,
      height: session.level.canvasBounds.maxY - session.level.canvasBounds.minY },
    backgroundAssetId: session.level.backgroundAssetUrl.split('/').pop().replace(/\.png$/, ''),
    objects: [] as any[], personalBackground: null, corePattern: null, personalElements: [],
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' }
}
function objectFor(sticker: any, index: number) {
  return { objectId: crypto.randomUUID(), assetId: sticker.stickerId, assetType: 'sticker',
    left: (sticker.targetArea.minX + sticker.targetArea.maxX) / 2,
    top: (sticker.targetArea.minY + sticker.targetArea.maxY) / 2,
    scaleX: 1, scaleY: 1, angle: 0, visible: true, locked: false, zIndex: index + 1 }
}

describe('private learning engine and verified completion', () => {
  const snapshot = catalog.assetSnapshotId
  function client(host = new LearningHost()) {
    return (path: string, method = 'GET', body?: unknown, owner = 'window-1', user = 'user-1', snap = snapshot): any =>
      host.request(owner, user, snap, path, method, body === undefined ? undefined : JSON.stringify(body))
  }
  it.each(listLevels().map(level => level.levelId))(
    'binds actual packaged resources and completes %s, not a UI flag', levelId => {
      const request = client()
      const session = request('/api/sessions', 'POST', { levelId })
      const path = `/api/sessions/${session.playSessionId}`
      expect(session.level.backgroundAssetUrl).toContain('felt-resource://material/')
      expect(() => request(`${path}/completion`)).toThrow('尚未完成')
      const scene = sceneFor(session)
      for (const sticker of session.level.stickers) {
        expect(sticker.stickerAssetUrl).toContain(snapshot)
        expect(sticker.narrationAudio).toHaveLength(3)
        expect(sticker.narrationAudio.every((audio: any) => audio.assetUrl.startsWith('felt-resource://audio/'))).toBe(true)
        expect(() => request(`${path}/placements`, 'POST', { stickerId: sticker.stickerId, x: 300, y: 300 })).toThrow('创作画布')
        const object = objectFor(sticker, scene.objects.length)
        scene.objects.push(object)
        const input = { stickerId: sticker.stickerId, scene, narratedAudio: sticker.narrationAudio.map((audio: any) => audio.assetUrl) }
        object.left = -999
        expect(() => request(`${path}/guide-step`, 'POST', input)).toThrow()
        object.left = (sticker.targetArea.minX + sticker.targetArea.maxX) / 2
        expect(request(`${path}/guide-step`, 'POST', input).success).toBe(true)
        expect(() => request(`${path}/guide-step`, 'POST', input)).toThrow('顺序')
      }
      const receipt = request(`${path}/completion`)
      expect(receipt).toMatchObject({ userId: 'user-1', assetSnapshotId: snapshot, themeId: session.level.themeId })
      expect(receipt.stickerIds).toEqual(session.level.stickers.map((s: any) => s.stickerId))
      expect([...receipt.stickerIds].sort()).toEqual(catalog.assets.filter(asset => asset.themeId === receipt.themeId && asset.type === 'sticker').map(asset => asset.assetId).sort())
      expect(request(path).allFinished).toBe(true)
    })
  it('rejects skipped audio, wrong theme, hidden/duplicate material, and edits to previous placements', () => {
    const request = client()
    const session = request('/api/sessions', 'POST', { levelId: 'mid-autumn-lake-001' })
    const path = `/api/sessions/${session.playSessionId}/guide-step`
    const first = session.level.stickers[0], scene = sceneFor(session)
    scene.objects.push(objectFor(first, 0))
    const input = { stickerId: first.stickerId, scene, narratedAudio: [] as string[] }
    expect(() => request(path, 'POST', input)).toThrow('讲解')
    input.narratedAudio = first.narrationAudio.map((a: any) => a.assetUrl)
    scene.themeId = 'spring'
    expect(() => request(path, 'POST', input)).toThrow('不一致')
    scene.themeId = session.level.themeId
    scene.objects[0].visible = false
    expect(() => request(path, 'POST', input)).toThrow()
    scene.objects[0].visible = true
    scene.objects.push({ ...scene.objects[0], objectId: 'duplicate', zIndex: 2 })
    expect(() => request(path, 'POST', input)).toThrow()
    scene.objects.pop()
    request(path, 'POST', input)
    const second = session.level.stickers[1]
    scene.objects.push(objectFor(second, 1))
    input.stickerId = second.stickerId
    input.narratedAudio = second.narrationAudio.map((a: any) => a.assetUrl)
    scene.objects[0].left = -100
    expect(() => request(path, 'POST', input)).toThrow()
    scene.objects[0] = objectFor(first, 0)
    scene.sceneId = crypto.randomUUID()
    expect(() => request(path, 'POST', input)).toThrow('身份')
  })
  it('rejects unknown levels, foreign window/user/snapshot and malformed paths', () => {
    const request = client()
    expect(request('/api/levels').levels.length).toBeGreaterThan(3)
    expect(() => request('/api/sessions', 'POST', { levelId: 'invented' })).toThrow('不存在')
    const session = request('/api/sessions', 'POST', { levelId: 'mid-autumn-lake-001' })
    const path = `/api/sessions/${session.playSessionId}`
    expect(() => request(path, 'GET', undefined, 'window-2')).toThrow('失效')
    expect(() => request(path, 'GET', undefined, 'window-1', 'user-2')).toThrow('失效')
    expect(() => request(path, 'GET', undefined, 'window-1', 'user-1', 'wrong')).toThrow('快照')
    expect(() => request(`${path}/../../completion`)).toThrow('路径')
    expect(() => request(`${path}/completion`, 'POST')).toThrow('方法')
    expect(learningFailure(new Error('safe error'))).toMatchObject({ ok: false, status: 400 })
  })
  it('expires the old session when the window starts another theme or closes', () => {
    const host = new LearningHost(), request = client(host)
    const old = request('/api/sessions', 'POST', { levelId: 'mid-autumn-lake-001' })
    const next = request('/api/sessions', 'POST', { levelId: 'lantern-street-001' })
    expect(() => request(`/api/sessions/${old.playSessionId}`)).toThrow('失效')
    expect(request(`/api/sessions/${next.playSessionId}`).allFinished).toBe(false)
    host.releaseOwner('window-1')
    expect(() => request(`/api/sessions/${next.playSessionId}`)).toThrow('失效')
  })
})

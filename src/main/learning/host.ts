import { validateGuidedScene } from './guided-scene'
import { GameService, GameError } from '../../../sticker-game-backend/src/game-service.js'
import { listLevels, toPublicLevel } from '../../../sticker-game-backend/src/levels.js'
import type { LearningCompletion } from '@shared/learning'
import catalog from '../../renderer/src/catalog/assets.manifest.json'
import registry from '../../renderer/src/catalog/snapshot-registry.json'

if (catalog.assetSnapshotId !== registry.latestSnapshotId) throw new Error('学习素材与当前素材库版本不一致。')

/** Reuse the existing game engine, privately in Main: no public localhost port. */
export class LearningHost {
  private readonly game = new GameService()
  private readonly owners = new Map<string, { owner: string; snapshotId: string; userId: string; guidedCount: number; sceneId?: string; completedAt?: string }>()

  releaseOwner(owner: string): void {
    for (const [sessionId, binding] of this.owners) {
      if (binding.owner !== owner) continue
      this.game.deleteSession(sessionId)
      this.owners.delete(sessionId)
    }
  }

  request(owner: string, userId: string, snapshotId: string, path: string, method: string, body?: string): unknown {
    if (snapshotId !== catalog.assetSnapshotId) throw new Error('学习素材快照不匹配。')
    if (method === 'GET' && path === '/api/levels') return { levels: listLevels().map(level => toPublicLevel(level)) }
    if (body && body.length > 8192) throw new Error('学习请求过大。')
    const input = body ? JSON.parse(body) : {}
    if (method === 'POST' && path === '/api/sessions') {
      const result = this.game.createSession(input.levelId)
      let bound: unknown
      try { bound = bindCatalogSession(result) }
      catch (error) { this.game.deleteSession(result.playSessionId); throw error }
      this.releaseOwner(owner)
      this.owners.set(result.playSessionId, { owner, snapshotId, userId, guidedCount: 0 })
      return bound
    }
    const match = path.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)(\/(placements|guide-step|completion))?$/)
    if (!match) throw new Error('学习请求路径无效。')
    const sessionId = match[1]
    const binding = this.owners.get(sessionId)
    if (!binding || binding.owner !== owner || binding.userId !== userId || binding.snapshotId !== snapshotId) {
      throw new Error('学习会话已失效，请重新开始当前主题。')
    }
    if (method === 'GET' && !match[3]) return bindCatalogSession(this.game.getSession(sessionId))
    if (method === 'POST' && match[3] === 'placements') throw new Error('请在创作画布中按引导完成任务。')
    if (method === 'POST' && match[3] === 'guide-step') {
      const session = bindCatalogSession(this.game.getSession(sessionId))
      const sticker = session.level.stickers[binding.guidedCount]
      if (!sticker || input.stickerId !== sticker.stickerId) throw new Error('请按主题引导顺序完成当前步骤。')
      if (JSON.stringify(input.narratedAudio) !== JSON.stringify(sticker.narrationAudio.map((audio: any) => audio.assetUrl))) {
        throw new Error('请先完成当前素材的名称与介绍讲解。')
      }
      if (binding.sceneId && input.scene?.sceneId !== binding.sceneId) throw new Error('任务画布身份不一致。')
      validateGuidedScene(input.scene, session, userId, snapshotId, binding.guidedCount + 1)
      const object = input.scene.objects.find((item: any) => item.assetId === sticker.stickerId)
      const result = this.game.placeSticker(sessionId, { stickerId: sticker.stickerId,
        x: object.left + session.level.canvasBounds.minX, y: object.top + session.level.canvasBounds.minY })
      binding.sceneId = input.scene.sceneId
      binding.guidedCount++
      if (result.allFinished) binding.completedAt = new Date().toISOString()
      return result
    }
    if (method === 'GET' && match[3] === 'completion') {
      const session = this.game.getSession(sessionId)
      if (binding.guidedCount !== session.level.stickers.length || !binding.completedAt || !session.allFinished || !session.level.stickers.length || session.level.stickers.some((s: any) => !s.isCompleted)) {
        throw new Error('学习任务尚未完成，不能解锁素材。')
      }
      return {
        userId, themeId: session.level.themeId, sessionId, assetSnapshotId: snapshotId,
        stickerIds: session.level.stickers.map((s: any) => s.stickerId), completedAt: binding.completedAt
      } satisfies LearningCompletion
    }
    throw new Error('学习请求方法无效。')
  }
}

function bindCatalogSession(session: any): any {
  const level = session.level
  const backgroundId = level.backgroundAssetUrl.split('/').pop().replace(/\.png$/, '')
  const background = catalog.assets.find(asset => asset.assetId === backgroundId && asset.themeId === level.themeId && asset.type === 'background')
  if (!background) throw new Error('当前安装包尚未包含此主题的背景素材，请更新素材包。')
  const stickers = level.stickers.map((sticker: any) => {
    const asset = catalog.assets.find(row => row.assetId === sticker.stickerId && row.themeId === level.themeId && row.type === 'sticker')
    if (!asset) throw new Error('当前安装包尚未包含此主题的全部贴纸，请更新素材包。')
    const narrationAudio = [
      { type: 'nameZh', assetUrl: asset.audio.nameZhUrl },
      { type: 'nameEn', assetUrl: asset.audio.nameEnUrl },
      { type: 'introZh', assetUrl: asset.audio.introZhUrl }
    ]
    if (narrationAudio.some(audio => !audio.assetUrl)) throw new Error('当前主题讲解音频不完整。')
    const placeholder = { ...sticker.placeholder }
    if (placeholder.outlineAssetUrl?.startsWith('/assets/')) placeholder.outlineAssetUrl = asset.imageUrl
    return { ...sticker, name: asset.nameZh, stickerAssetUrl: asset.imageUrl, narrationAudio, placeholder }
  })
  return { ...session, level: { ...level, backgroundAssetUrl: background.imageUrl, stickers } }
}

export function learningFailure(error: unknown) {
  return { ok: false as const, status: error instanceof GameError ? error.status : 400,
    payload: { error: { code: error instanceof GameError ? error.code : 'LEARNING_REQUEST_FAILED',
      message: error instanceof Error ? error.message : '学习请求失败。' } } }
}

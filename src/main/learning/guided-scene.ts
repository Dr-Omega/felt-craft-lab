import { validateSceneDocument } from '../../shared/contracts'

/** Check actual exported canvas content, never a renderer's `passed` flag. */
export function validateGuidedScene(input: unknown, session: any, userId: string, snapshotId: string, count: number): void {
  const parsed = validateSceneDocument(input)
  if (!parsed.ok) throw new Error('任务画布数据无效。')
  const scene = parsed.value
  const level = session.level
  const bounds = level.canvasBounds
  const backgroundId = level.backgroundAssetUrl.split('/').pop().replace(/\.png$/, '')
  if (scene.userId !== userId || scene.themeId !== level.themeId || scene.assetSnapshotId !== snapshotId
    || scene.backgroundAssetId !== backgroundId || scene.personalBackground || scene.corePattern || scene.personalElements.length
    || scene.canvas.width !== bounds.maxX - bounds.minX || scene.canvas.height !== bounds.maxY - bounds.minY) {
    throw new Error('任务画布与主题、背景或素材版本不一致。')
  }
  const expected = level.stickers.slice(0, count)
  if (scene.objects.length !== expected.length) throw new Error('请按顺序添加本主题指定素材，不能遗漏或重复。')
  for (const sticker of expected) {
    const matches = scene.objects.filter(item => item.assetId === sticker.stickerId)
    if (matches.length !== 1) throw new Error('任务素材缺失或重复。')
    const object = matches[0]
    const area = sticker.targetArea
    const x = object.left + bounds.minX, y = object.top + bounds.minY
    if (!object.visible || object.scaleX <= 0 || object.scaleY <= 0
      || x < area.minX - sticker.tolerance || x > area.maxX + sticker.tolerance
      || y < area.minY - sticker.tolerance || y > area.maxY + sticker.tolerance) {
      throw new Error(`请把${sticker.name}放到引导位置；已完成的素材也需要保留在正确位置。`)
    }
  }
}

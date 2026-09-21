import type {
  AssetRecord,
  ProjectRecord,
  StoryCardWorkContext,
  StoryCardWorkElement
} from '@shared/contracts'
import { persistenceError } from '../persistence/errors'

export interface StoryCardAssetReader {
  listBySnapshot(snapshotId: string): readonly AssetRecord[]
}

const THEME_NAMES: Record<string, string> = {
  lantern_festival: '元宵',
  mid_autumn_festival: '中秋',
  spring_festival: '春节'
}

function toWorkElement(asset: AssetRecord): StoryCardWorkElement {
  return {
    name: asset.nameZh,
    themeName: THEME_NAMES[asset.themeId] ?? asset.themeId
  }
}

/**
 * Converts a completed ProjectRecord into the story-card contract without
 * exposing the editable SceneDocument or material identifiers.
 */
export function adaptStoryCardWorkContext(
  work: ProjectRecord,
  assetReader: StoryCardAssetReader
): StoryCardWorkContext {
  if (work.completionStatus !== 'completed' || !work.scene.subject) {
    throw persistenceError('WORK_NOT_COMPLETED', '请先完成主体创作，再创建故事卡。')
  }

  const assetsById = new Map(
    assetReader.listBySnapshot(work.scene.assetSnapshotId).map((asset) => [asset.assetId, asset])
  )
  const assetFor = (assetId: string): AssetRecord => {
    const asset = assetsById.get(assetId)
    if (!asset) {
      throw persistenceError('ASSET_NOT_FOUND', '作品所用素材暂时找不到。')
    }
    return asset
  }

  return {
    workId: work.projectId,
    completionStatus: 'completed',
    artworkImageRef: work.previewUrl,
    background: work.scene.backgroundAssetId === null
      ? null
      : toWorkElement(assetFor(work.scene.backgroundAssetId)),
    subject: { name: work.scene.subject.name },
    stickers: work.scene.objects.map((object) => toWorkElement(assetFor(object.assetId)))
  }
}

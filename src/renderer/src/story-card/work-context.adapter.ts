import type {
  AssetRecord,
  ProjectRecord,
  StoryCardWorkContext,
  StoryCardWorkElement
} from '@shared/contracts'
import { hasSavedArtwork } from './completed-work.service'
import { persistenceError } from '../persistence/errors'
import { THEME_NAMES } from '../catalog/theme-labels'

export interface StoryCardAssetReader {
  listBySnapshot(snapshotId: string): readonly AssetRecord[]
  personalName?(personalAssetId: string, versionId: string): string | undefined
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
  if (!hasSavedArtwork(work)) {
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

  const personalName = (item: { personalAssetId: string; versionId: string }): string => {
    const name = assetReader.personalName?.(item.personalAssetId, item.versionId)
    if (!name) throw persistenceError('ASSET_NOT_FOUND', '作品所用个人素材版本暂时找不到。')
    return name
  }

  return {
    workId: work.projectId,
    completionStatus: 'completed',
    artworkImageRef: work.previewUrl,
    background: work.scene.personalBackground
      ? { name: personalName(work.scene.personalBackground) }
      : work.scene.backgroundAssetId === null
      ? null
      : toWorkElement(assetFor(work.scene.backgroundAssetId)),
    subject: { name: work.scene.corePattern?.visible ? personalName(work.scene.corePattern) : work.projectName },
    stickers: [
      ...work.scene.objects.filter(object => object.visible).map((object) => toWorkElement(assetFor(object.assetId))),
      ...work.scene.personalElements.filter(object => object.visible).map(object => ({ name: personalName(object) }))
    ]
  }
}

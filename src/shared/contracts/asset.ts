import type { AssetRuntimeStatus, AssetType, ResourceRef, UtcIso8601 } from './common'

export interface AssetAudioRefs {
  nameZhUrl?: ResourceRef
  nameEnUrl?: ResourceRef
  introZhUrl?: ResourceRef
}

/** Safe runtime projection of a material Manifest entry. */
export interface AssetRecord {
  assetId: string
  type: AssetType
  themeId: string
  categoryIds: string[]
  nameZh: string
  nameEn: string
  introZh: string
  keywords: string[]
  imageUrl: ResourceRef
  thumbnailUrl?: ResourceRef
  preSplitDataUrl?: ResourceRef
  audio: AssetAudioRefs
  source?: string
  license?: string
  contentVersion: number
  status: AssetRuntimeStatus
}

/**
 * User-level permission to add an asset. Resource loss is not represented by
 * changing this state: it is reported through SharedError during recovery.
 */
export interface AssetAccessState {
  userId: string
  assetId: string
  unlocked: boolean
  unlockSource?: string
  updatedAt: UtcIso8601
}


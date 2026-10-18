import type { ResourceRef, UtcIso8601, Uuid } from './common'
import type { ProvidedPsdEdit } from '../provided-psd'

export const PERSONAL_ASSET_ROLES = ['core_pattern', 'element', 'background'] as const
export type PersonalAssetRole = (typeof PERSONAL_ASSET_ROLES)[number]

export const PERSONAL_ASSET_SOURCE_TYPES = ['ai_generated', 'uploaded', 'hand_drawn'] as const
export type PersonalAssetSourceType = (typeof PERSONAL_ASSET_SOURCE_TYPES)[number]

/** A logical item in the user's personal asset library. */
export interface PersonalAssetRecord {
  personalAssetId: Uuid
  /** Existing application user identifiers are non-UUID strings. */
  userId: string
  role: PersonalAssetRole
  sourceType: PersonalAssetSourceType
  name: string
  currentVersionId: Uuid
  createdAt: UtcIso8601
  updatedAt: UtcIso8601
}

/** Immutable content version of a PersonalAssetRecord. */
export interface PersonalAssetVersionRecord {
  versionId: Uuid
  personalAssetId: Uuid
  versionNumber: number
  sourceImageRef: ResourceRef
  parentVersionId: Uuid | null
  createdAt: UtcIso8601
  providedPsd?: ProvidedPsdEdit
}

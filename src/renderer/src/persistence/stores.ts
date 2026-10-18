import type { StoryCard, StoryCardRepository } from '@shared/contracts'
import type {
  AssetAccessState,
  DraftRecord,
  PersonalAssetRecord,
  PersonalAssetVersionRecord,
  ProjectRecord
} from '@shared/contracts'
import {
  validateAssetAccessState,
  validateDraftRecord,
  validatePersonalAssetRecord,
  validatePersonalAssetVersionRecord,
  validateProjectRecord
} from '@shared/contracts/validation'
import { migrateDraftRecord as migrateDraftRecordValue, migrateProjectRecord as migrateProjectRecordValue } from '@shared/contracts/scene-migration'
import { FELT_RESOURCE_REF_POLICY, isPersonalAssetSourceRefFor } from '@shared/resource'
import type { FeltCraftDatabase } from './db'
import { persistenceError } from './errors'
import { isFavoriteRecord, type FavoriteRecord } from './favorites'

function rejectDraft(message: string): never {
  throw persistenceError('DRAFT_SAVE_FAILED', message)
}

function rejectProject(message: string): never {
  throw persistenceError('PROJECT_SAVE_FAILED', message)
}

function rejectAccess(message: string): never {
  throw persistenceError('INVALID_ARGUMENT', message)
}

function rejectFavorite(message: string): never {
  throw persistenceError('INVALID_ARGUMENT', message)
}

function rejectPersonalAsset(message: string): never {
  throw persistenceError('INVALID_ARGUMENT', message)
}

function rejectPersonalAssetVersion(message: string): never {
  throw persistenceError('INVALID_ARGUMENT', message)
}

function assertPersonalAssetVersionResource(record: PersonalAssetVersionRecord): void {
  if (!isPersonalAssetSourceRefFor(record.sourceImageRef, record.personalAssetId, record.versionId)) {
    rejectPersonalAssetVersion('Personal Asset Version 的 sourceImageRef 必须是对应 personalAssetId/versionId 的 personal source.png。')
  }
}

export class DraftStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<DraftRecord> {
    let migrated: unknown
    try {
      migrated = migrateDraftRecordValue(raw)
    } catch {
      rejectDraft('草稿记录的 Scene schemaVersion 不受支持。')
    }
    const validated = validateDraftRecord(migrated)
    if (!validated.ok) rejectDraft('草稿记录未通过 Shared Contract 校验。')
    const record = structuredClone(validated.value) as DraftRecord
    await this.db.drafts.put(record)
    return Object.freeze(structuredClone(record)) as DraftRecord
  }

  async get(draftId: string): Promise<DraftRecord | undefined> {
    const raw = await this.db.drafts.get(draftId)
    if (raw === undefined) return undefined
    let migrated: unknown
    try {
      migrated = migrateDraftRecordValue(raw)
    } catch {
      rejectDraft('读取到的草稿记录的 Scene schemaVersion 不受支持。')
    }
    const validated = validateDraftRecord(migrated)
    if (!validated.ok) rejectDraft('读取到的草稿记录未通过 Shared Contract 校验。')
    return Object.freeze(structuredClone(validated.value)) as DraftRecord
  }

  async list(): Promise<DraftRecord[]> {
    const rows = await this.db.drafts.orderBy('updatedAt').reverse().toArray()
    return rows.map((raw) => {
      let migrated: unknown
      try {
        migrated = migrateDraftRecordValue(raw)
      } catch {
        rejectDraft('读取到的草稿记录的 Scene schemaVersion 不受支持。')
      }
      const validated = validateDraftRecord(migrated)
      if (!validated.ok) rejectDraft('读取到的草稿记录未通过 Shared Contract 校验。')
      return Object.freeze(structuredClone(validated.value)) as DraftRecord
    })
  }

  async delete(draftId: string): Promise<void> {
    await this.db.drafts.delete(draftId)
  }
}

export class ProjectStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<ProjectRecord> {
    let migrated: unknown
    try {
      migrated = migrateProjectRecordValue(raw)
    } catch {
      rejectProject('作品记录的 Scene schemaVersion 不受支持。')
    }
    const validated = validateProjectRecord(migrated, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectProject('作品记录未通过 Shared Contract 校验。')
    const record = structuredClone(validated.value) as ProjectRecord
    await this.db.projects.put(record)
    return Object.freeze(structuredClone(record)) as ProjectRecord
  }

  async get(projectId: string): Promise<ProjectRecord | undefined> {
    const raw = await this.db.projects.get(projectId)
    if (raw === undefined) return undefined
    let migrated: unknown
    try {
      migrated = migrateProjectRecordValue(raw)
    } catch {
      rejectProject('读取到的作品记录的 Scene schemaVersion 不受支持。')
    }
    const validated = validateProjectRecord(migrated, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectProject('读取到的作品记录未通过 Shared Contract 校验。')
    return Object.freeze(structuredClone(validated.value)) as ProjectRecord
  }

  async list(): Promise<ProjectRecord[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray()
    return rows.map((raw) => {
      let migrated: unknown
      try {
        migrated = migrateProjectRecordValue(raw)
      } catch {
        rejectProject('读取到的作品记录的 Scene schemaVersion 不受支持。')
      }
      const validated = validateProjectRecord(migrated, FELT_RESOURCE_REF_POLICY)
      if (!validated.ok) rejectProject('读取到的作品记录未通过 Shared Contract 校验。')
      return Object.freeze(structuredClone(validated.value)) as ProjectRecord
    })
  }

  async delete(projectId: string): Promise<void> {
    await this.db.projects.delete(projectId)
  }
}

export class PersonalAssetStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<PersonalAssetRecord> {
    const validated = validatePersonalAssetRecord(raw)
    if (!validated.ok) rejectPersonalAsset('个人素材记录未通过 Shared Contract 校验。')
    const record = structuredClone(validated.value) as PersonalAssetRecord
    await this.assertCurrentVersionOwner(record)
    await this.db.personalAssets.put(record)
    return Object.freeze(structuredClone(record)) as PersonalAssetRecord
  }

  async get(personalAssetId: string): Promise<PersonalAssetRecord | undefined> {
    const raw = await this.db.personalAssets.get(personalAssetId)
    if (raw === undefined) return undefined
    const validated = validatePersonalAssetRecord(raw)
    if (!validated.ok) rejectPersonalAsset('读取到的个人素材记录未通过 Shared Contract 校验。')
    await this.assertCurrentVersionOwner(validated.value)
    return Object.freeze(structuredClone(validated.value)) as PersonalAssetRecord
  }

  async listForUser(userId: string): Promise<PersonalAssetRecord[]> {
    const rows = await this.db.personalAssets.where('userId').equals(userId).toArray()
    const records: PersonalAssetRecord[] = []
    for (const raw of rows) {
      const validated = validatePersonalAssetRecord(raw)
      if (!validated.ok) rejectPersonalAsset('读取到的个人素材记录未通过 Shared Contract 校验。')
      await this.assertCurrentVersionOwner(validated.value)
      records.push(Object.freeze(structuredClone(validated.value)) as PersonalAssetRecord)
    }
    return records
  }

  async delete(personalAssetId: string): Promise<void> {
    await this.db.personalAssets.delete(personalAssetId)
  }

  private async assertCurrentVersionOwner(record: PersonalAssetRecord): Promise<void> {
    const versionRaw = await this.db.personalAssetVersions.get(record.currentVersionId)
    if (versionRaw === undefined) {
      rejectPersonalAsset('个人素材当前版本不存在。')
    }
    const version = validatePersonalAssetVersionRecord(versionRaw, FELT_RESOURCE_REF_POLICY)
    if (!version.ok) {
      rejectPersonalAsset('个人素材当前版本未通过 Shared Contract 校验。')
    }
    if (!isPersonalAssetSourceRefFor(version.value.sourceImageRef, version.value.personalAssetId, version.value.versionId)) {
      rejectPersonalAsset('个人素材当前版本的 sourceImageRef 不是对应的 personal source.png。')
    }
    if (version.value.personalAssetId !== record.personalAssetId) {
      rejectPersonalAsset('个人素材当前版本不属于该个人素材。')
    }
  }
}

export class PersonalAssetVersionStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<PersonalAssetVersionRecord> {
    const validated = validatePersonalAssetVersionRecord(raw, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectPersonalAssetVersion('个人素材版本记录未通过 Shared Contract 校验。')
    const record = structuredClone(validated.value) as PersonalAssetVersionRecord
    assertPersonalAssetVersionResource(record)

    const existingRaw = await this.db.personalAssetVersions.get(record.versionId)
    if (existingRaw !== undefined) {
      const existing = validatePersonalAssetVersionRecord(existingRaw, FELT_RESOURCE_REF_POLICY)
      if (!existing.ok) rejectPersonalAssetVersion('已有 Personal Asset Version 记录未通过 Shared Contract 校验。')
      assertPersonalAssetVersionResource(existing.value)
      if (samePersonalAssetVersion(existing.value, record)) {
        return Object.freeze(structuredClone(existing.value)) as PersonalAssetVersionRecord
      }
      rejectPersonalAssetVersion('Personal Asset Version 是 immutable，已有 versionId 不能被修改或覆盖。')
    }

    await this.assertVersionChain(record)
    await this.db.personalAssetVersions.put(record)
    return Object.freeze(structuredClone(record)) as PersonalAssetVersionRecord
  }

  async get(versionId: string): Promise<PersonalAssetVersionRecord | undefined> {
    const raw = await this.db.personalAssetVersions.get(versionId)
    if (raw === undefined) return undefined
    const validated = validatePersonalAssetVersionRecord(raw, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectPersonalAssetVersion('读取到的个人素材版本记录未通过 Shared Contract 校验。')
    assertPersonalAssetVersionResource(validated.value)
    return Object.freeze(structuredClone(validated.value)) as PersonalAssetVersionRecord
  }

  async listForAsset(personalAssetId: string): Promise<PersonalAssetVersionRecord[]> {
    const rows = await this.db.personalAssetVersions.where('personalAssetId').equals(personalAssetId).toArray()
    return rows.map((raw) => {
      const validated = validatePersonalAssetVersionRecord(raw, FELT_RESOURCE_REF_POLICY)
      if (!validated.ok) rejectPersonalAssetVersion('读取到的个人素材版本记录未通过 Shared Contract 校验。')
      assertPersonalAssetVersionResource(validated.value)
      return Object.freeze(structuredClone(validated.value)) as PersonalAssetVersionRecord
    })
  }

  async delete(versionId: string): Promise<void> {
    await this.db.personalAssetVersions.delete(versionId)
  }

  private async assertVersionChain(record: PersonalAssetVersionRecord): Promise<void> {
    const existingRows = await this.db.personalAssetVersions.where('personalAssetId').equals(record.personalAssetId).toArray()
    for (const raw of existingRows) {
      const existing = validatePersonalAssetVersionRecord(raw, FELT_RESOURCE_REF_POLICY)
      if (!existing.ok) rejectPersonalAssetVersion('已有个人素材版本记录未通过 Shared Contract 校验。')
      assertPersonalAssetVersionResource(existing.value)
      if (existing.value.versionNumber === record.versionNumber && existing.value.versionId !== record.versionId) {
        rejectPersonalAssetVersion('同一 Personal Asset 的 versionNumber 不得重复。')
      }
    }

    if (record.versionNumber <= 1) return
    if (record.parentVersionId === null) {
      rejectPersonalAssetVersion('后续个人素材版本必须引用父版本。')
    }
    const parentRaw = await this.db.personalAssetVersions.get(record.parentVersionId)
    if (parentRaw === undefined) rejectPersonalAssetVersion('个人素材父版本不存在。')
    const parent = validatePersonalAssetVersionRecord(parentRaw, FELT_RESOURCE_REF_POLICY)
    if (!parent.ok) rejectPersonalAssetVersion('个人素材父版本未通过 Shared Contract 校验。')
    assertPersonalAssetVersionResource(parent.value)
    if (parent.value.personalAssetId !== record.personalAssetId) {
      rejectPersonalAssetVersion('个人素材父版本不属于当前 Personal Asset。')
    }
    if (parent.value.versionNumber !== record.versionNumber - 1) {
      rejectPersonalAssetVersion('个人素材父版本必须是紧邻的上一版本。')
    }
  }
}

function samePersonalAssetVersion(
  left: PersonalAssetVersionRecord,
  right: PersonalAssetVersionRecord
): boolean {
  return left.versionId === right.versionId
    && left.personalAssetId === right.personalAssetId
    && left.versionNumber === right.versionNumber
    && left.sourceImageRef === right.sourceImageRef
    && left.parentVersionId === right.parentVersionId
    && left.createdAt === right.createdAt
    && JSON.stringify(left.providedPsd) === JSON.stringify(right.providedPsd)
}

export class AssetAccessStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<AssetAccessState> {
    const validated = validateAssetAccessState(raw)
    if (!validated.ok) rejectAccess('解锁状态未通过 Shared Contract 校验。')
    const value = structuredClone(validated.value)
    await this.db.assetAccess.put(value)
    return Object.freeze(structuredClone(value)) as AssetAccessState
  }

  async get(userId: string, assetId: string): Promise<AssetAccessState | undefined> {
    const raw = await this.db.assetAccess.get([userId, assetId])
    if (raw === undefined) return undefined
    const validated = validateAssetAccessState(raw)
    if (!validated.ok) rejectAccess('读取到的解锁状态未通过 Shared Contract 校验。')
    return Object.freeze(structuredClone(validated.value)) as AssetAccessState
  }

  async listForUser(userId: string): Promise<AssetAccessState[]> {
    const rows = await this.db.assetAccess.where('userId').equals(userId).toArray()
    return rows.map((raw) => {
      const validated = validateAssetAccessState(raw)
      if (!validated.ok) rejectAccess('读取到的解锁状态未通过 Shared Contract 校验。')
      return Object.freeze(structuredClone(validated.value)) as AssetAccessState
    })
  }

  async delete(userId: string, assetId: string): Promise<void> {
    await this.db.assetAccess.delete([userId, assetId])
  }
}

export class FavoriteStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<FavoriteRecord> {
    if (!isFavoriteRecord(raw)) rejectFavorite('收藏记录格式无效。')
    const frozen = Object.freeze(structuredClone(raw)) as FavoriteRecord
    await this.db.favorites.put(frozen)
    return frozen
  }

  async get(userId: string, assetId: string): Promise<FavoriteRecord | undefined> {
    const raw = await this.db.favorites.get([userId, assetId])
    if (raw === undefined) return undefined
    if (!isFavoriteRecord(raw)) rejectFavorite('读取到的收藏记录格式无效。')
    return Object.freeze(structuredClone(raw)) as FavoriteRecord
  }

  async listForUser(userId: string): Promise<FavoriteRecord[]> {
    const rows = await this.db.favorites.where('userId').equals(userId).toArray()
    return rows.map((raw) => {
      if (!isFavoriteRecord(raw)) rejectFavorite('读取到的收藏记录格式无效。')
      return Object.freeze(structuredClone(raw)) as FavoriteRecord
    })
  }

  async delete(userId: string, assetId: string): Promise<void> {
    await this.db.favorites.delete([userId, assetId])
  }
}

export class StoryCardStore implements StoryCardRepository {
  constructor(private readonly db: FeltCraftDatabase) {}

  async create(card: StoryCard): Promise<StoryCard> {
    const record = storyCardRecord(card)
    await this.db.storyCards.add(record)
    return Object.freeze(structuredClone(record)) as StoryCard
  }

  async getByWorkId(workId: string): Promise<StoryCard | undefined> {
    const card = await this.db.storyCards.get(workId)
    if (card === undefined) return undefined
    return Object.freeze(structuredClone(card)) as StoryCard
  }

  async replace(card: StoryCard): Promise<StoryCard> {
    const record = storyCardRecord(card)
    await this.db.storyCards.put(record)
    return Object.freeze(structuredClone(record)) as StoryCard
  }
}

function storyCardRecord(card: StoryCard): StoryCard {
  return {
    workId: card.workId,
    artworkImageRef: card.artworkImageRef,
    title: card.title,
    storyText: card.storyText,
    originalAudioRef: card.originalAudioRef,
    confirmedAt: card.confirmedAt
  }
}

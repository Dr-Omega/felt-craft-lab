import type {
  AssetAccessState,
  DraftRecord,
  ProjectRecord,
  StoryCard,
  StoryCardRepository
} from '@shared/contracts'
import {
  validateAssetAccessState,
  validateDraftRecord,
  validateProjectRecord
} from '@shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource'
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

export class DraftStore {
  constructor(private readonly db: FeltCraftDatabase) {}

  async save(raw: unknown): Promise<DraftRecord> {
    const validated = validateDraftRecord(raw, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectDraft('草稿记录未通过 Shared Contract 校验。')
    const record = structuredClone(validated.value) as DraftRecord
    await this.db.drafts.put(record)
    return Object.freeze(structuredClone(record)) as DraftRecord
  }

  async get(draftId: string): Promise<DraftRecord | undefined> {
    const raw = await this.db.drafts.get(draftId)
    if (raw === undefined) return undefined
    const validated = validateDraftRecord(raw, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectDraft('读取到的草稿记录未通过 Shared Contract 校验。')
    return Object.freeze(structuredClone(validated.value)) as DraftRecord
  }

  async list(): Promise<DraftRecord[]> {
    const rows = await this.db.drafts.orderBy('updatedAt').reverse().toArray()
    return rows.map((raw) => {
      const validated = validateDraftRecord(raw, FELT_RESOURCE_REF_POLICY)
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
    const validated = validateProjectRecord(raw, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectProject('作品记录未通过 Shared Contract 校验。')
    const record = structuredClone(validated.value) as ProjectRecord
    await this.db.projects.put(record)
    return Object.freeze(structuredClone(record)) as ProjectRecord
  }

  async get(projectId: string): Promise<ProjectRecord | undefined> {
    const raw = await this.db.projects.get(projectId)
    if (raw === undefined) return undefined
    const validated = validateProjectRecord(raw, FELT_RESOURCE_REF_POLICY)
    if (!validated.ok) rejectProject('读取到的作品记录未通过 Shared Contract 校验。')
    return Object.freeze(structuredClone(validated.value)) as ProjectRecord
  }

  async list(): Promise<ProjectRecord[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray()
    return rows.map((raw) => {
      const validated = validateProjectRecord(raw, FELT_RESOURCE_REF_POLICY)
      if (!validated.ok) rejectProject('读取到的作品记录未通过 Shared Contract 校验。')
      return Object.freeze(structuredClone(validated.value)) as ProjectRecord
    })
  }

  async delete(projectId: string): Promise<void> {
    await this.db.projects.delete(projectId)
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

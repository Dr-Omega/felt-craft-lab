import type { DraftRecord, SceneDocument } from '@shared/contracts'
import type { EditorSessionState } from '../editor/editor-session.types'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { saveDraftFromPreparedScene } from './draft-workflow'

/** A short pause keeps Fabric interaction responsive while avoiding write storms. */
export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 800

export interface DraftAutosaveSession {
  getState(): EditorSessionState
  prepareDraftSave(): SceneDocument
  markSaved(): void
}

export type DraftAutosaveSave = (
  scene: SceneDocument,
  options: { draftId?: string; db?: FeltCraftDatabase }
) => Promise<DraftRecord>

export interface DraftAutosaveOptions {
  session: DraftAutosaveSession
  draftId?: string
  db?: FeltCraftDatabase
  debounceMs?: number
  saveDraft?: DraftAutosaveSave
  onSaved?: (draft: DraftRecord) => void
  onError?: (error: unknown) => void
}

/**
 * Renderer-only autosave coordinator. It delegates all serialization and
 * persistence to the existing EditorSession and draft workflow; it owns only
 * debounce, draft identity, and revision-safe completion handling.
 */
export class DraftAutosaveController {
  private readonly session: DraftAutosaveSession
  private readonly db: FeltCraftDatabase | undefined
  private readonly debounceMs: number
  private readonly saveDraft: DraftAutosaveSave
  private readonly onSaved: ((draft: DraftRecord) => void) | undefined
  private readonly onError: ((error: unknown) => void) | undefined
  private draftId: string | undefined
  private timer: ReturnType<typeof globalThis.setTimeout> | undefined
  private saving: Promise<void> | undefined
  private queued = false
  private disposed = false

  constructor(options: DraftAutosaveOptions) {
    this.session = options.session
    this.draftId = options.draftId
    this.db = options.db
    this.debounceMs = options.debounceMs ?? DRAFT_AUTOSAVE_DEBOUNCE_MS
    this.saveDraft = options.saveDraft ?? saveDraftFromPreparedScene
    this.onSaved = options.onSaved
    this.onError = options.onError
  }

  getDraftId(): string | undefined {
    return this.draftId
  }

  /** Call with every EditorSession state update. Selection-only updates are ignored by `isDirty`. */
  notify(state = this.session.getState()): void {
    if (this.disposed || !this.canSave(state)) return
    this.queued = true
    this.schedule()
  }

  /**
   * Finish any pending debounce/write before an explicit return-to-library save.
   * `force` is deliberately reserved for that explicit user action: a pristine
   * newly opened Scene still needs its first Draft record when the user chooses
   * "save progress", while ordinary autosave remains revision-driven.
   */
  async flush(force = false): Promise<void> {
    if (this.disposed) return
    if (this.timer !== undefined) {
      globalThis.clearTimeout(this.timer)
      this.timer = undefined
    }
    const state = this.session.getState()
    if (this.canSave(state)) this.queued = true
    if (force && !state.isDirty && state.canPrepareDraft && state.historyRevision !== undefined) {
      try {
        await this.persist(state.historyRevision)
      } catch (error) {
        this.onError?.(error)
        throw error
      }
      return
    }
    await this.runQueuedSave(true)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer)
    this.timer = undefined
  }

  private canSave(state: EditorSessionState): boolean {
    return state.canPrepareDraft && state.isDirty && state.historyRevision !== undefined
  }

  private schedule(): void {
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer)
    this.timer = globalThis.setTimeout(() => {
      this.timer = undefined
      void this.runQueuedSave()
    }, this.debounceMs)
  }

  private async runQueuedSave(throwOnError = false): Promise<void> {
    if (this.saving) {
      await this.saving.catch((error) => {
        if (throwOnError) throw error
      })
      if (this.queued && !this.disposed) await this.runQueuedSave(throwOnError)
      return
    }
    if (!this.queued || this.disposed || !this.canSave(this.session.getState())) return

    this.queued = false
    const revision = this.session.getState().historyRevision
    if (revision === undefined) return
    this.saving = this.persist(revision)
    try {
      await this.saving
    } catch (error) {
      this.onError?.(error)
      if (throwOnError) throw error
    } finally {
      this.saving = undefined
    }

    // A change during the write owns a newer revision and must schedule a new write.
    const currentRevision = this.session.getState().historyRevision
    if (!this.disposed && currentRevision !== revision && this.canSave(this.session.getState())) {
      this.queued = true
      this.schedule()
    } else {
      this.queued = false
    }
  }

  private async persist(revision: number): Promise<void> {
    const scene = this.session.prepareDraftSave()
    const saved = await this.saveDraft(scene, { draftId: this.draftId, db: this.db ?? getFeltCraftDatabase() })
    this.draftId = saved.draftId
    // Do not clear dirty state if a newer Scene was committed while Dexie was writing.
    if (!this.disposed && this.session.getState().historyRevision === revision) this.session.markSaved()
    this.onSaved?.(saved)
  }
}

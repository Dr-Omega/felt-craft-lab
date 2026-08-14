import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorSessionState } from '../../src/renderer/src/editor/editor-session.types'
import {
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
  DraftAutosaveController,
  DraftStore,
  createFeltCraftDatabase,
  saveDraftFromPreparedScene,
  type FeltCraftDatabase
} from '../../src/renderer/src/persistence'
import { preparedScene } from './fixtures'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class AutosaveSession {
  scene = preparedScene()
  revision = 1
  savedRevision = 1
  prepareCalls = 0

  getState(): EditorSessionState {
    return {
      status: 'ready',
      sceneId: this.scene.sceneId,
      pendingOperations: 0,
      recoveryIssues: [],
      canEdit: true,
      isDirty: this.revision !== this.savedRevision,
      historyRevision: this.revision,
      canUndo: true,
      canRedo: false,
      canPrepareDraft: true,
      canPrepareProject: true
    }
  }

  prepareDraftSave() {
    this.prepareCalls += 1
    return structuredClone(this.scene)
  }

  markSaved(): void {
    this.savedRevision = this.revision
  }

  mutate(mutator?: () => void): void {
    mutator?.()
    this.revision += 1
  }
}

describe('DraftAutosaveController', () => {
  let db: FeltCraftDatabase

  beforeEach(() => {
    db = createFeltCraftDatabase(`felt-draft-autosave-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await db.delete()
  })

  it('AUTOSAVE_01: waits for debounce, then saves the changed Scene', async () => {
    expect(DRAFT_AUTOSAVE_DEBOUNCE_MS).toBe(800)
    const session = new AutosaveSession()
    const saveDraft = vi.fn(saveDraftFromPreparedScene)
    const autosave = new DraftAutosaveController({ session, db, saveDraft, debounceMs: 25 })

    session.mutate(() => { session.scene.backgroundAssetId = 'background_autosave_001' })
    autosave.notify()
    await wait(10)
    expect(saveDraft).not.toHaveBeenCalled()

    await wait(45)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(session.getState().isDirty).toBe(false)
    const draft = await new DraftStore(db).get(autosave.getDraftId()!)
    expect(draft?.scene.backgroundAssetId).toBe('background_autosave_001')
  })

  it('AUTOSAVE_02: coalesces repeated drag revisions into one current Draft write', async () => {
    const session = new AutosaveSession()
    const saveDraft = vi.fn(saveDraftFromPreparedScene)
    const autosave = new DraftAutosaveController({ session, db, saveDraft, debounceMs: 25 })

    for (const left of [120, 180, 240]) {
      session.mutate(() => { session.scene.objects[0]!.left = left })
      autosave.notify()
      await wait(5)
    }
    await wait(45)

    expect(saveDraft).toHaveBeenCalledTimes(1)
    const draft = await new DraftStore(db).get(autosave.getDraftId()!)
    expect(draft?.scene.objects[0]?.left).toBe(240)
  })

  it('AUTOSAVE_03: selection-only state does not schedule a Draft write', async () => {
    const session = new AutosaveSession()
    const saveDraft = vi.fn(saveDraftFromPreparedScene)
    const autosave = new DraftAutosaveController({ session, db, saveDraft })

    autosave.notify(session.getState())
    await wait(35)

    expect(saveDraft).not.toHaveBeenCalled()
    expect(session.prepareCalls).toBe(0)
  })

  it('persists a pristine Scene only when the user explicitly requests save progress', async () => {
    const session = new AutosaveSession()
    const autosave = new DraftAutosaveController({ session, db, debounceMs: 5 })

    await autosave.flush(true)

    const saved = await new DraftStore(db).get(autosave.getDraftId()!)
    expect(saved?.scene).toEqual(session.scene)
  })

  it('AUTOSAVE_04: retains one draftId for successive saves', async () => {
    const session = new AutosaveSession()
    const autosave = new DraftAutosaveController({ session, db, debounceMs: 5 })

    session.mutate(() => { session.scene.objects[0]!.left = 111 })
    autosave.notify()
    await wait(25)
    const firstId = autosave.getDraftId()

    session.mutate(() => { session.scene.objects[0]!.left = 222 })
    autosave.notify()
    await wait(25)

    expect(autosave.getDraftId()).toBe(firstId)
    const drafts = await new DraftStore(db).list()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.scene.objects[0]?.left).toBe(222)
  })

  it('AUTOSAVE_05: a failed write preserves the prior Draft and lets a later revision retry', async () => {
    const session = new AutosaveSession()
    const existing = await saveDraftFromPreparedScene(session.prepareDraftSave(), { db })
    const errors: unknown[] = []
    const saveDraft = vi.fn(async () => { throw new Error('dexie down') })
    const autosave = new DraftAutosaveController({ session, db, draftId: existing.draftId, debounceMs: 5, saveDraft, onError: (error) => errors.push(error) })

    session.mutate(() => { session.scene.objects[0]!.left = 444 })
    autosave.notify()
    await wait(25)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(1)
    expect((await new DraftStore(db).get(existing.draftId))?.scene.objects[0]?.left).not.toBe(444)

    session.mutate(() => { session.scene.objects[0]!.left = 555 })
    const retry = vi.fn(saveDraftFromPreparedScene)
    const retryAutosave = new DraftAutosaveController({ session, db, draftId: existing.draftId, debounceMs: 5, saveDraft: retry })
    retryAutosave.notify()
    await wait(25)
    expect(retry).toHaveBeenCalledTimes(1)
    expect((await new DraftStore(db).get(existing.draftId))?.scene.objects[0]?.left).toBe(555)
  })

  it('AUTOSAVE_06: a saved Draft can be reopened after a database restart with its Scene transform intact', async () => {
    const name = `felt-draft-autosave-restart-${crypto.randomUUID()}`
    const restartDb = createFeltCraftDatabase(name)
    const session = new AutosaveSession()
    const autosave = new DraftAutosaveController({ session, db: restartDb, debounceMs: 5 })
    session.mutate(() => {
      session.scene.objects[0] = {
        ...session.scene.objects[0]!,
        left: 321, top: 456,
        scaleX: 0.75, scaleY: 0.75, angle: -30, zIndex: 1
      }
    })
    autosave.notify()
    await wait(25)
    const draftId = autosave.getDraftId()!
    restartDb.close()

    const reopened = createFeltCraftDatabase(name)
    const restored = await new DraftStore(reopened).get(draftId)
    expect(restored?.scene.backgroundAssetId).toBe(session.scene.backgroundAssetId)
    expect(restored?.scene.objects).toEqual(session.scene.objects)
    await reopened.delete()
  })
})

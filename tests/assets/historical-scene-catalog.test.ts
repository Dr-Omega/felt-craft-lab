import { describe, expect, it } from 'vitest'
import type { AssetRecord, SceneDocument } from '../../src/shared/contracts'
import { assetsForEditor, pickSelectedAsset } from '../../src/renderer/src/catalog/editor-selection'
import {
  getCatalogAssetsForSnapshot,
  resolveEditorCatalogForSnapshot,
  YWN_ASSETS,
  YWN_SNAPSHOT_ID
} from '../../src/renderer/src/catalog/ywn-catalog'
import { EditorSessionService, type EditorSessionAdapter } from '../../src/renderer/src/editor'
import type { FabricEditorAssetResolver, SceneImportResult, SceneRecoveryIssue } from '../../src/renderer/src/editor'
import type { EditorSelectionEvent, EditorSelectionListener } from '../../src/renderer/src/editor'
import type { EditorHistoryListener, EditorHistoryProjection } from '../../src/renderer/src/editor'
import { cloneFixture, validScene } from '../shared/contracts.fixtures'

function sticker(snapshotId: string, imageToken: string, contentVersion: number): AssetRecord {
  return {
    assetId: 'sticker_fu_001',
    type: 'sticker',
    themeId: 'spring_festival',
    categoryIds: ['festival_decoration'],
    nameZh: '福字',
    nameEn: 'Fu',
    introZh: 'intro',
    keywords: ['春节'],
    imageUrl: `felt-resource://material/${snapshotId}/sticker_fu_001.png`,
    thumbnailUrl: `felt-resource://material/${snapshotId}/sticker_fu_001_thumb.png`,
    audio: {},
    source: 'test',
    license: 'test',
    contentVersion,
    status: 'ready',
    preSplitDataUrl: imageToken
  }
}

class RecoveryStubAdapter implements EditorSessionAdapter {
  issues: SceneRecoveryIssue[] = []
  scene: SceneDocument | undefined
  private readonly selectionListeners = new Set<EditorSelectionListener>()
  private readonly historyListeners = new Set<EditorHistoryListener>()
  private historyProjection: EditorHistoryProjection = { revision: 0, canUndo: false, canRedo: false }

  initialize(_element: HTMLCanvasElement, scene: SceneDocument): void {
    this.scene = cloneFixture(scene)
  }

  async importScene(scene: SceneDocument, _resolver: FabricEditorAssetResolver): Promise<SceneImportResult> {
    this.scene = cloneFixture(scene)
    this.issues = [
      {
        code: 'ASSET_SNAPSHOT_MISMATCH',
        message: 'Scene asset snapshot is unavailable.',
        assetType: 'sticker'
      }
    ]
    this.historyProjection = { revision: this.historyProjection.revision + 1, canUndo: false, canRedo: false }
    for (const listener of this.historyListeners) listener({ ...this.historyProjection })
    return { issues: [...this.issues] }
  }

  async setBackground(): Promise<void> {}
  setSolidBackground(): void {}
  setTransparentBackground(): void {}
  resizeCanvas(): void {}
  async addSticker(): Promise<string> {
    return 'object-1'
  }
  deleteObject(): void {}
  deleteSelected(): void {}
  bringForward(): void {}
  sendBackward(): void {}
  bringToFront(): void {}
  sendToBack(): void {}
  bringSelectedForward(): void {}
  sendSelectedBackward(): void {}
  bringSelectedToFront(): void {}
  sendSelectedToBack(): void {}
  async undo(): Promise<boolean> {
    return false
  }
  async redo(): Promise<boolean> {
    return false
  }
  getHistoryProjection(): EditorHistoryProjection {
    return { ...this.historyProjection }
  }
  subscribeHistory(listener: EditorHistoryListener): () => void {
    this.historyListeners.add(listener)
    return () => this.historyListeners.delete(listener)
  }
  markSaved(): void {}
  exportScene(): SceneDocument {
    return cloneFixture(this.scene!)
  }
  async exportPng(): Promise<Blob> {
    return new Blob(['png'], { type: 'image/png' })
  }
  getRecoveryIssues(): readonly SceneRecoveryIssue[] {
    return this.issues
  }

  subscribeSelection(listener: EditorSelectionListener): () => void {
    this.selectionListeners.add(listener)
    return () => this.selectionListeners.delete(listener)
  }

  emitSelection(event: EditorSelectionEvent): void {
    for (const listener of this.selectionListeners) listener(event)
  }
  dispose(): void {}
}

describe('historical Scene Editor catalog selection', () => {
  it('exposes formal latest assets via getCatalogAssetsForSnapshot(latest)', () => {
    const assets = getCatalogAssetsForSnapshot(YWN_SNAPSHOT_ID)
    expect(assets.length).toBe(17)
    expect(assets.every((asset) => asset.imageUrl.includes(`/${YWN_SNAPSHOT_ID}/`))).toBe(true)
  })

  it('throws when snapshot is missing (no latest fallback)', () => {
    expect(() => getCatalogAssetsForSnapshot('snapshot_missing_zzz')).toThrow(/Asset snapshot not found/)
  })

  it('missing snapshot: Editor setup stays controlled, picker empty, Session enters recovery', async () => {
    const missingId = 'snapshot_entirely_gone_001'
    expect(() => resolveEditorCatalogForSnapshot(missingId)).not.toThrow()
    const catalog = resolveEditorCatalogForSnapshot(missingId)
    expect(catalog.snapshotMissing).toBe(true)
    expect(catalog.assets).toEqual([])
    expect(catalog.assets.length).not.toBe(YWN_ASSETS.length)
    expect(YWN_ASSETS.some((asset) => catalog.assets.includes(asset))).toBe(false)

    const scene = cloneFixture(validScene)
    scene.assetSnapshotId = missingId
    const adapter = new RecoveryStubAdapter()
    const service = new EditorSessionService({ createAdapter: () => adapter })
    await service.open({} as HTMLCanvasElement, scene, {
      async resolveAsset() {
        throw new Error(`Asset snapshot not found: ${missingId}`)
      }
    })

    const state = service.getState()
    expect(state.status).toBe('recovery')
    expect(state.recoveryIssues.some((issue) => issue.code === 'ASSET_SNAPSHOT_MISMATCH')).toBe(true)
    expect(assetsForEditor(catalog.assets, 'sticker', scene.themeId)).toEqual([])
    expect(pickSelectedAsset('sticker_fu_001', catalog.assets as AssetRecord[])).toBeUndefined()
  })

  it('keeps Editor picker on snapshot_001 AssetRecord A when latest is B', () => {
    const snap1 = 'snapshot_001'
    const snap2 = 'snapshot_002'
    const assetA = sticker(snap1, 'image-A', 1)
    const assetB = sticker(snap2, 'image-B', 2)
    const bySnapshot = new Map<string, Map<string, AssetRecord>>([
      [snap1, new Map([[assetA.assetId, assetA]])],
      [snap2, new Map([[assetB.assetId, assetB]])]
    ])

    const scene: Pick<SceneDocument, 'assetSnapshotId' | 'themeId'> = {
      assetSnapshotId: snap1,
      themeId: 'spring_festival'
    }
    const sceneAssets = [...(bySnapshot.get(scene.assetSnapshotId)?.values() ?? [])]
    expect(sceneAssets).toHaveLength(1)
    expect(sceneAssets[0]?.preSplitDataUrl).toBe('image-A')
    expect(sceneAssets[0]?.contentVersion).toBe(1)

    const stickers = assetsForEditor(sceneAssets, 'sticker', scene.themeId)
    const selected = pickSelectedAsset('sticker_fu_001', stickers)
    expect(selected?.imageUrl).toContain(`/${snap1}/`)
    expect(selected?.preSplitDataUrl).toBe('image-A')
    expect(selected?.contentVersion).toBe(1)
    expect(selected?.imageUrl).not.toContain(snap2)
    expect(selected?.preSplitDataUrl).not.toBe('image-B')
    expect(scene.assetSnapshotId).toBe(snap1)
  })
})

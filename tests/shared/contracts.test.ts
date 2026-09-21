import { describe, expect, it } from 'vitest'
import {
  isSafeResourceRef,
  isSharedError,
  toSharedError,
  validateAssetAccessState,
  validateAssetRecord,
  validateAsrResult,
  validateDraftRecord,
  validateProjectRecord,
  validateQaResult,
  validateSceneDocument,
  validateSceneDocumentAgainstSnapshot,
  validateSceneObject,
  validateSharedError,
  validateTtsResult,
  type ResourceRefValidationPolicy,
  type SceneDocument,
  type SceneSnapshotValidationContext
} from '../../src/shared/contracts'
import {
  cloneFixture,
  validAccess,
  validAsset,
  validAsrResult,
  validDraft,
  validProject,
  validQaResult,
  validScene,
  validSceneObject,
  validSharedError,
  validSnapshotContext,
  validTtsResult
} from './contracts.fixtures'

describe('shared material-library contracts', () => {
  it('accepts every valid fixture through the public runtime entry points', () => {
    expect(validateAssetRecord(validAsset).ok).toBe(true)
    expect(validateAssetAccessState(validAccess).ok).toBe(true)
    expect(validateSceneObject(validSceneObject).ok).toBe(true)
    expect(validateSceneDocument(validScene).ok).toBe(true)
    expect(validateSceneDocumentAgainstSnapshot(validScene, validSnapshotContext).ok).toBe(true)
    expect(validateDraftRecord(validDraft).ok).toBe(true)
    expect(validateProjectRecord(validProject).ok).toBe(true)
    expect(validateAsrResult(validAsrResult).ok).toBe(true)
    expect(validateQaResult(validQaResult).ok).toBe(true)
    expect(validateTtsResult(validTtsResult).ok).toBe(true)
    expect(validateSharedError(validSharedError).ok).toBe(true)
  })

  it('rejects a SceneDocument without the required assetSnapshotId', () => {
    const scene = cloneFixture(validScene) as unknown as Record<string, unknown>
    delete scene.assetSnapshotId
    expect(validateSceneDocument(scene).ok).toBe(false)
  })

  it('permits a locked asset record but preserves the access boundary as data only', () => {
    const access = { ...validAccess, unlocked: false }
    expect(validateAssetAccessState(access).ok).toBe(true)
  })

  it('rejects a background object in the sticker stack instead of assigning it any zIndex', () => {
    const backgroundObject = { ...validSceneObject, assetType: 'background', zIndex: 1 }
    expect(validateSceneObject(backgroundObject).ok).toBe(false)
  })

  it('rejects duplicate, non-continuous, or less-than-one sticker layers', () => {
    const duplicate = cloneFixture(validScene)
    duplicate.objects.push({ ...validSceneObject, objectId: 'ed742af5-5e80-48bb-a507-df80d9031adb', zIndex: 1 })
    expect(validateSceneDocument(duplicate).ok).toBe(false)

    const nonContinuous = cloneFixture(validScene)
    nonContinuous.objects[0].zIndex = 2
    expect(validateSceneDocument(nonContinuous).ok).toBe(false)

    expect(validateSceneObject({ ...validSceneObject, zIndex: 0 }).ok).toBe(false)
  })

  it('enforces angle boundaries and V1 proportional scaling', () => {
    expect(validateSceneObject({ ...validSceneObject, angle: -180 }).ok).toBe(true)
    expect(validateSceneObject({ ...validSceneObject, angle: 179.999 }).ok).toBe(true)
    expect(validateSceneObject({ ...validSceneObject, angle: 180 }).ok).toBe(false)
    expect(validateSceneObject({ ...validSceneObject, angle: -180.001 }).ok).toBe(false)
    expect(validateSceneObject({ ...validSceneObject, scaleY: 0.7 }).ok).toBe(false)
  })

  it('uses mock by default and accepts a formal protocol only when injected by the resolver', () => {
    const resolverPolicy: ResourceRefValidationPolicy = { allowedProtocols: ['felt-resource:'] }
    expect(isSafeResourceRef('mock://assets/lantern.png')).toBe(true)
    expect(isSafeResourceRef('felt-resource://previews/saved.png')).toBe(false)
    expect(isSafeResourceRef('felt-resource://previews/saved.png', resolverPolicy)).toBe(true)
    expect(validateProjectRecord({
      ...validProject,
      scene: {
        ...validProject.scene,
        subject: { ...validProject.scene.subject!, imageRef: 'felt-resource://previews/subject.png' }
      },
      previewUrl: 'felt-resource://previews/saved.png'
    }, resolverPolicy).ok).toBe(true)
  })

  it('rejects unstable, unsafe, credential-bearing, fragmented, and traversal resource references', () => {
    for (const previewUrl of [
      'blob:https://app.example/preview',
      'C:\\Users\\child\\preview.png',
      'https://example.com/preview.png',
      'mock://previews/saved.png?rawToken=secret',
      'mock://user:password@previews/saved.png',
      'mock://previews/saved.png#fragment',
      'mock://previews/../saved.png',
      'mock://previews/%2e%2e/saved.png',
      'mock://previews/%252e%252e/saved.png'
    ]) {
      expect(validateProjectRecord({ ...validProject, previewUrl }).ok).toBe(false)
    }
  })

  it('requires the formal project preview and an exact project/Scene name match', () => {
    const missingPreview = cloneFixture(validProject) as unknown as Record<string, unknown>
    delete missingPreview.previewUrl
    expect(validateProjectRecord(missingPreview).ok).toBe(false)
    expect(validateProjectRecord({ ...validProject, projectName: '不同的名字' }).ok).toBe(false)
  })

  it('requires an explicit allowed project completion status', () => {
    const missingCompletionStatus = cloneFixture(validProject) as unknown as Record<string, unknown>
    delete missingCompletionStatus.completionStatus
    expect(validateProjectRecord(missingCompletionStatus).ok).toBe(false)
    expect(validateProjectRecord({ ...validProject, completionStatus: 'publishing' }).ok).toBe(false)
  })

  it('accepts an empty generated subject slot and rejects malformed generated subjects', () => {
    expect(validateSceneDocument({ ...validScene, subject: null }).ok).toBe(true)
    expect(validateSceneDocument({ ...validScene, subject: { name: '', imageRef: 'mock://subjects/rabbit.png' } }).ok).toBe(false)
    expect(validateSceneDocument({ ...validScene, subject: { name: '小兔子', imageRef: 'https://example.com/rabbit.png' } }).ok).toBe(false)
  })

  it('rebuilds a clean SharedError and drops unknown provider fields', () => {
    const providerError = {
      ...validSharedError,
      rawToken: 'do-not-leak',
      rawHeaders: 'authorization: Bearer do-not-leak'
    }
    expect(isSharedError(providerError)).toBe(false)
    expect(toSharedError(providerError)).toEqual(validSharedError)
    expect(toSharedError(providerError)).not.toHaveProperty('rawToken')
    expect(toSharedError(providerError)).not.toHaveProperty('rawHeaders')
    expect(validateSharedError(providerError).ok).toBe(false)
  })

  it('rejects unknown frozen error codes and does not leak an unknown exception', () => {
    expect(validateSharedError({ ...validSharedError, code: 'SOMETHING_NEW' }).ok).toBe(false)
    expect(toSharedError(new Error('provider key=do-not-leak'))).toEqual({
      code: 'UNKNOWN',
      message: '请求暂时无法完成，请稍后重试。',
      retryable: true
    })
  })

  it('returns a structured failure instead of throwing for calendar-invalid UTC timestamps', () => {
    const malformedScene = { ...validScene, createdAt: '2026-99-99T99:99:99.999Z' }
    expect(() => validateSceneDocument(malformedScene)).not.toThrow()
    expect(validateSceneDocument(malformedScene).ok).toBe(false)
  })

  it('checks snapshot existence, asset membership, and background/sticker types without changing SceneDocument', () => {
    expect(validateSceneDocumentAgainstSnapshot(validScene, { snapshots: {} }).ok).toBe(false)

    const wrongBackgroundType: SceneSnapshotValidationContext = {
      snapshots: {
        [validScene.assetSnapshotId]: [
          { assetId: 'background_moon_001', type: 'sticker' },
          { assetId: validAsset.assetId, type: 'sticker' }
        ]
      }
    }
    expect(validateSceneDocumentAgainstSnapshot(validScene, wrongBackgroundType).ok).toBe(false)

    const wrongStickerType: SceneSnapshotValidationContext = {
      snapshots: {
        [validScene.assetSnapshotId]: [
          { assetId: 'background_moon_001', type: 'background' },
          { assetId: validAsset.assetId, type: 'background' }
        ]
      }
    }
    expect(validateSceneDocumentAgainstSnapshot(validScene, wrongStickerType).ok).toBe(false)

    const foreignSticker: SceneSnapshotValidationContext = {
      snapshots: {
        [validScene.assetSnapshotId]: [{ assetId: 'background_moon_001', type: 'background' }]
      }
    }
    expect(validateSceneDocumentAgainstSnapshot(validScene, foreignSticker).ok).toBe(false)
  })

  it('returns structured failures for prototype-chain snapshot IDs without throwing', () => {
    for (const assetSnapshotId of ['toString', 'constructor', '__proto__']) {
      const sceneWithPrototypeKey = { ...validScene, assetSnapshotId }
      expect(() => validateSceneDocumentAgainstSnapshot(sceneWithPrototypeKey, validSnapshotContext)).not.toThrow()
      expect(validateSceneDocumentAgainstSnapshot(sceneWithPrototypeKey, validSnapshotContext).ok).toBe(false)
    }
  })

  it('keeps ASR end-to-end duration distinct from optional recording duration', () => {
    expect(validateAsrResult(validAsrResult).ok).toBe(true)
    expect(validateAsrResult({ ...validAsrResult, audioDurationMs: undefined }).ok).toBe(true)
    const missingDuration = cloneFixture(validAsrResult) as unknown as Record<string, unknown>
    delete missingDuration.durationMs
    expect(validateAsrResult(missingDuration).ok).toBe(false)
    expect(validateAsrResult({ ...validAsrResult, durationMs: -1 }).ok).toBe(false)
  })

  it('keeps a resource exception separate from permanent unlocked access', () => {
    const resourceError = { ...validSharedError, code: 'ASSET_NOT_FOUND' }
    expect(validateSharedError(resourceError).ok).toBe(true)
    expect(validateAssetAccessState(validAccess)).toMatchObject({ ok: true, value: { unlocked: true } })
  })

  it('round-trips a legal SceneDocument through JSON without losing validation', () => {
    const restored = JSON.parse(JSON.stringify(validScene)) as unknown
    expect(validateSceneDocument(restored).ok).toBe(true)
  })

  it('does not allow a TypeScript assertion to bypass runtime validation of persistent data', () => {
    const persistedUnknown: unknown = { schemaVersion: 1, sceneId: 'not-a-uuid' }
    const asserted = persistedUnknown as SceneDocument
    expect(validateSceneDocument(asserted).ok).toBe(false)
  })
})


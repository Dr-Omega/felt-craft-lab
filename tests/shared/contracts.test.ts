import { describe, expect, it } from 'vitest'
import {
  toSharedError,
  validateAssetAccessState,
  validateAssetRecord,
  validateAsrResult,
  validateDraftRecord,
  validateProjectRecord,
  validateQaResult,
  validateSceneDocument,
  validateSceneObject,
  validateSharedError,
  validateTtsResult,
  type SceneDocument
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
  validTtsResult
} from './contracts.fixtures'

describe('shared material-library contracts', () => {
  it('accepts every valid fixture through the public runtime entry points', () => {
    expect(validateAssetRecord(validAsset).ok).toBe(true)
    expect(validateAssetAccessState(validAccess).ok).toBe(true)
    expect(validateSceneObject(validSceneObject).ok).toBe(true)
    expect(validateSceneDocument(validScene).ok).toBe(true)
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

  it('rejects unstable, absolute, and unsafe remote preview references', () => {
    for (const previewUrl of [
      'blob:https://app.example/preview',
      'C:\\Users\\child\\preview.png',
      'https://example.com/preview.png',
      'app://previews/saved.png?token=secret'
    ]) {
      expect(validateProjectRecord({ ...validProject, previewUrl }).ok).toBe(false)
    }
  })

  it('requires the formal project preview and an exact project/Scene name match', () => {
    const missingPreview = cloneFixture(validProject) as unknown as Record<string, unknown>
    delete missingPreview.previewUrl
    expect(validateProjectRecord(missingPreview).ok).toBe(false)
    expect(validateProjectRecord({ ...validProject, projectName: '涓嶅悓鐨勫悕瀛? }).ok).toBe(false)
  })

  it('rejects unknown frozen error codes and does not leak an unknown exception', () => {
    expect(validateSharedError({ ...validSharedError, code: 'SOMETHING_NEW' }).ok).toBe(false)
    expect(toSharedError(new Error('provider key=do-not-leak'))).toEqual({
      code: 'UNKNOWN',
      message: '璇锋眰鏆傛椂鏃犳硶瀹屾垚锛岃绋嶅悗閲嶈瘯銆?,
      retryable: true
    })
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


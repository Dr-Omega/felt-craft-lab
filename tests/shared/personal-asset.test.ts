import { describe, expect, it } from 'vitest'
import {
  validatePersonalAssetRecord,
  validatePersonalAssetVersionRecord,
  validateSceneCorePatternObject,
  validateSceneDocument,
  validateScenePersonalElement,
  validateScenePersonalBackground,
  validateScenePersonalObject
} from '../../src/shared/contracts'
import { cloneFixture, validScene } from './contracts.fixtures'

const personalAssetId = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
const versionId = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const userId = 'user_demo_001'
const objectId = '2a8c8c2b-66ef-43b5-9ea4-748af0eac3b4'

const validPersonalAsset = {
  personalAssetId,
  userId,
  role: 'element' as const,
  sourceType: 'uploaded' as const,
  name: '我的花朵',
  currentVersionId: versionId,
  createdAt: '2026-07-30T05:10:00.000Z',
  updatedAt: '2026-07-30T05:20:00.000Z'
}

const validVersion = {
  versionId,
  personalAssetId,
  versionNumber: 1,
  sourceImageRef: 'mock://personal-assets/flower-v1.png',
  parentVersionId: null,
  createdAt: '2026-07-30T05:20:00.000Z'
}

const validPersonalObject = {
  objectId,
  personalAssetId,
  versionId,
  left: 420,
  top: 260,
  scaleX: 0.8,
  scaleY: 1.1,
  angle: 15,
  visible: true,
  locked: false
}

describe('Personal Asset contracts', () => {
  it('accepts valid PersonalAssetRecord and rejects invalid role, source, and IDs', () => {
    expect(validatePersonalAssetRecord(validPersonalAsset).ok).toBe(true)
    expect(validatePersonalAssetRecord({ ...validPersonalAsset, role: 'sticker' }).ok).toBe(false)
    expect(validatePersonalAssetRecord({ ...validPersonalAsset, sourceType: 'provider' }).ok).toBe(false)
    expect(validatePersonalAssetRecord({ ...validPersonalAsset, personalAssetId: 'not-a-uuid' }).ok).toBe(false)
    expect(validatePersonalAssetRecord({ ...validPersonalAsset, currentVersionId: 'not-a-uuid' }).ok).toBe(false)
  })

  it('accepts valid versions and enforces version number and safe ResourceRef rules', () => {
    expect(validatePersonalAssetVersionRecord(validVersion).ok).toBe(true)
    expect(validatePersonalAssetVersionRecord({ ...validVersion, versionNumber: 0 }).ok).toBe(false)
    for (const sourceImageRef of [
      'http://example.com/image.png',
      'https://example.com/image.png',
      'file:///tmp/image.png',
      'blob:https://app.example/image',
      'data:image/png;base64,abc'
    ]) {
      expect(validatePersonalAssetVersionRecord({ ...validVersion, sourceImageRef }).ok).toBe(false)
    }
    expect(validatePersonalAssetVersionRecord({ ...validVersion, sourceImageRef: 'mock://personal-assets/flower-v1.png' }).ok).toBe(true)
  })
})

describe('Scene V2 personal references', () => {
  it('accepts empty, personal background, core pattern, and multiple element scenes', () => {
    expect(validateSceneDocument(validScene).ok).toBe(true)
    const scene = cloneFixture(validScene)
    scene.backgroundAssetId = null
    scene.personalBackground = { personalAssetId, versionId }
    scene.corePattern = { ...validPersonalObject, objectId: '8d4bbd2b-7288-4a19-b0dd-5bf43fd1cb9e' }
    scene.personalElements = [
      { ...validPersonalObject, zIndex: 2 },
      { ...validPersonalObject, zIndex: 3, objectId: '1ea8d75e-5949-440c-9db5-c7b4eaf4a6d1', left: 120 }
    ]
    expect(validateScenePersonalBackground(scene.personalBackground).ok).toBe(true)
    expect(validateScenePersonalObject(scene.corePattern).ok).toBe(true)
    expect(validateSceneDocument(scene).ok).toBe(true)
  })

  it('validates one global continuous Element tier across system and personal elements', () => {
    const mixed = cloneFixture(validScene)
    mixed.personalElements = [{ ...validPersonalObject, zIndex: 2 }]
    expect(validateSceneDocument(mixed).ok).toBe(true)

    const personalOnly = cloneFixture(validScene)
    personalOnly.objects = []
    personalOnly.personalElements = [
      { ...validPersonalObject, zIndex: 1 },
      { ...validPersonalObject, zIndex: 2, objectId: '1ea8d75e-5949-440c-9db5-c7b4eaf4a6d1' }
    ]
    expect(validateSceneDocument(personalOnly).ok).toBe(true)

    const duplicate = cloneFixture(validScene)
    duplicate.personalElements = [{ ...validPersonalObject, zIndex: 1 }]
    expect(validateSceneDocument(duplicate).ok).toBe(false)

    const gap = cloneFixture(validScene)
    gap.personalElements = [{ ...validPersonalObject, zIndex: 3 }]
    expect(validateSceneDocument(gap).ok).toBe(false)
  })

  it('keeps Core Pattern zIndex-free while Personal Element requires zIndex', () => {
    expect(validateSceneCorePatternObject(validPersonalObject).ok).toBe(true)
    expect(validateSceneCorePatternObject({ ...validPersonalObject, zIndex: 1 }).ok).toBe(false)
    expect(validateScenePersonalElement({ ...validPersonalObject, zIndex: 1 }).ok).toBe(true)
    expect(validateScenePersonalElement(validPersonalObject).ok).toBe(false)
  })

  it('rejects mutually exclusive backgrounds, duplicate personal object IDs, and invalid transforms', () => {
    const withBothBackgrounds = cloneFixture(validScene)
    withBothBackgrounds.personalBackground = { personalAssetId, versionId }
    expect(validateSceneDocument(withBothBackgrounds).ok).toBe(false)

    const duplicate = cloneFixture(validScene)
    duplicate.personalElements = [{ ...validPersonalObject, zIndex: 2 }, { ...validPersonalObject, zIndex: 3 }]
    expect(validateSceneDocument(duplicate).ok).toBe(false)

    expect(validateScenePersonalObject({ ...validPersonalObject, left: Number.NaN }).ok).toBe(false)
    expect(validateScenePersonalObject({ ...validPersonalObject, scaleX: 0 }).ok).toBe(false)
    expect(validateScenePersonalObject({ ...validPersonalObject, angle: -180 }).ok).toBe(true)
    expect(validateScenePersonalObject({ ...validPersonalObject, angle: 179.999 }).ok).toBe(true)
    expect(validateScenePersonalObject({ ...validPersonalObject, angle: 180 }).ok).toBe(false)
    expect(validateScenePersonalObject({ ...validPersonalObject, angle: -180.001 }).ok).toBe(false)
  })
})

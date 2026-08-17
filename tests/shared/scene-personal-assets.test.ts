import { describe, expect, it } from 'vitest'
import { validateSceneDocumentAgainstPersonalAssets } from '../../src/shared/contracts'
import type { PersonalAssetRecord, PersonalAssetVersionRecord, SceneDocument } from '../../src/shared/contracts'
import { cloneFixture, validScene } from './contracts.fixtures'

const userId = 'user_demo_001'
const otherUserId = 'user_other_001'
const backgroundAssetId = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
const backgroundVersionV1 = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const backgroundVersionV2 = 'a9c70a06-bc96-4b7e-a934-d6eeb8c7de19'
const coreAssetId = '2a8c8c2b-66ef-43b5-9ea4-748af0eac3b4'
const coreVersionId = '8d4bbd2b-7288-4a19-b0dd-5bf43fd1cb9e'
const elementAssetId = '1ea8d75e-5949-440c-9db5-c7b4eaf4a6d1'
const elementVersionId = '7f1d2e3c-4b5a-46c7-8d9e-0f1a2b3c4d5e'
const objectId = '4c5d6e7f-8091-4a2b-b3c4-d5e6f7081920'

function asset(
  personalAssetId: string,
  role: PersonalAssetRecord['role'],
  currentVersionId: string,
  owner = userId
): PersonalAssetRecord {
  return {
    personalAssetId,
    userId: owner,
    role,
    sourceType: 'uploaded',
    name: `${role} asset`,
    currentVersionId,
    createdAt: '2026-07-30T05:10:00.000Z',
    updatedAt: '2026-07-30T05:20:00.000Z'
  }
}

function version(
  versionId: string,
  personalAssetId: string,
  versionNumber: number,
  parentVersionId: string | null
): PersonalAssetVersionRecord {
  return {
    versionId,
    personalAssetId,
    versionNumber,
    sourceImageRef: `mock://personal-assets/${versionId}.png`,
    parentVersionId,
    createdAt: '2026-07-30T05:20:00.000Z'
  }
}

const context = {
  personalAssets: [
    asset(backgroundAssetId, 'background', backgroundVersionV2),
    asset(coreAssetId, 'core_pattern', coreVersionId),
    asset(elementAssetId, 'element', elementVersionId)
  ],
  personalAssetVersions: [
    version(backgroundVersionV1, backgroundAssetId, 1, null),
    version(backgroundVersionV2, backgroundAssetId, 2, backgroundVersionV1),
    version(coreVersionId, coreAssetId, 1, null),
    version(elementVersionId, elementAssetId, 1, null)
  ]
}

function personalScene(): SceneDocument {
  const scene = cloneFixture(validScene)
  scene.userId = userId
  scene.backgroundAssetId = null
  scene.personalBackground = null
  scene.corePattern = null
  scene.personalElements = []
  return scene
}

describe('Scene Personal Asset cross-table validation', () => {
  it('accepts a historical version that is not currentVersionId', () => {
    const scene = personalScene()
    scene.personalBackground = { personalAssetId: backgroundAssetId, versionId: backgroundVersionV1 }
    expect(validateSceneDocumentAgainstPersonalAssets(scene, context).ok).toBe(true)
  })

  it('rejects references whose role does not match the Scene slot', () => {
    const backgroundSlot = personalScene()
    backgroundSlot.personalBackground = { personalAssetId: elementAssetId, versionId: elementVersionId }
    expect(validateSceneDocumentAgainstPersonalAssets(backgroundSlot, context).ok).toBe(false)

    const coreSlot = personalScene()
    coreSlot.corePattern = {
      objectId,
      personalAssetId: backgroundAssetId,
      versionId: backgroundVersionV1,
      left: 10,
      top: 20,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      visible: true,
      locked: false
    }
    expect(validateSceneDocumentAgainstPersonalAssets(coreSlot, context).ok).toBe(false)

    const elementSlot = personalScene()
    elementSlot.personalElements = [{
      objectId,
      personalAssetId: coreAssetId,
      versionId: coreVersionId,
      left: 10,
      top: 20,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      visible: true,
      locked: false
    }]
    expect(validateSceneDocumentAgainstPersonalAssets(elementSlot, context).ok).toBe(false)
  })

  it('rejects wrong version ownership and wrong asset user', () => {
    const wrongVersion = personalScene()
    wrongVersion.personalBackground = { personalAssetId: backgroundAssetId, versionId: elementVersionId }
    expect(validateSceneDocumentAgainstPersonalAssets(wrongVersion, context).ok).toBe(false)

    const wrongUser = personalScene()
    wrongUser.personalBackground = { personalAssetId: backgroundAssetId, versionId: backgroundVersionV1 }
    const wrongUserContext = {
      ...context,
      personalAssets: [asset(backgroundAssetId, 'background', backgroundVersionV2, otherUserId), ...context.personalAssets.slice(1)]
    }
    expect(validateSceneDocumentAgainstPersonalAssets(wrongUser, wrongUserContext).ok).toBe(false)
  })
})

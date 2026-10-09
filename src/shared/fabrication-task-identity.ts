import type { SceneBinding } from './fabrication-colors'

/** Scene transforms and timestamps are not image identity. Membership/version are. */
export function elementSourceIdentity(binding: SceneBinding | null | undefined): unknown {
  if (!binding?.objectId) return binding ?? null
  const scene = binding.scene
  const item = [...scene.objects, ...scene.personalElements, ...(scene.corePattern ? [scene.corePattern] : [])]
    .find(item => item.objectId === binding.objectId)
  if (!item) throw new Error('来源元素不存在。')
  return { userId: scene.userId, sceneId: scene.sceneId, objectId: binding.objectId,
    source: 'versionId' in item ? [item.personalAssetId, item.versionId] : [scene.assetSnapshotId, item.assetId] }
}

export function sameElementSource(a: SceneBinding | null | undefined, b: SceneBinding | null | undefined): boolean {
  return JSON.stringify(elementSourceIdentity(a)) === JSON.stringify(elementSourceIdentity(b))
}

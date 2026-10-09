import { getCurrentUserId } from '../services/plaza-session'
import type { ProjectRecord, StoryCardWorkContext } from '@shared/contracts'
import { createCatalogResolver, getCatalogAssetsForSnapshot } from '../catalog/ywn-catalog'
import { getFeltCraftDatabase, ProjectStore } from '../persistence'
import { requireCompletedWork } from '../story-card/completed-work.service'
import { adaptStoryCardWorkContext } from '../story-card/work-context.adapter'

/** Public entry seam for Library, Editor and the future lobby. Always reload by ID. */
export async function loadSavedWork(projectId: string): Promise<ProjectRecord> {
  const work = await requireCompletedWork(projectId, new ProjectStore(getFeltCraftDatabase()))
  if (work.scene.userId !== getCurrentUserId()) throw new Error('此作品不属于当前账号。')
  return work
}

export async function savedWorkStoryContext(work: ProjectRecord): Promise<StoryCardWorkContext> {
  const names = new Map<string, string>()
  const resolver = createCatalogResolver()
  const personal = [work.scene.personalBackground, work.scene.corePattern, ...work.scene.personalElements]
    .filter(item => item !== null)
  for (const item of personal) {
    const { asset, version } = await resolver.resolvePersonalAsset!(item.personalAssetId, item.versionId)
    if (asset.userId !== work.scene.userId) throw new Error('作品引用了不属于当前用户的个人素材。')
    names.set(version.versionId, asset.name)
  }
  return adaptStoryCardWorkContext(work, {
    listBySnapshot: getCatalogAssetsForSnapshot,
    personalName: (_assetId, versionId) => names.get(versionId)
  })
}

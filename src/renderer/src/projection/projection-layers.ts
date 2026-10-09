import type { AssetRecord, SceneDocument, SceneObject } from '@shared/contracts'
import { createCatalogResolver } from '../catalog/ywn-catalog'

export type ProjectionLayerKind = 'background' | 'sticker'

export interface ProjectionLayerDescriptor {
  layerNumber: number
  kind: ProjectionLayerKind
  assetId: string
  label: string
  imageUrl: string
  zIndex: number
}

export interface BuildProjectionLayersOptions {
  includeBackground: boolean
}

export async function buildProjectionLayers(
  scene: SceneDocument,
  options: BuildProjectionLayersOptions
): Promise<ProjectionLayerDescriptor[]> {
  const resolver = createCatalogResolver()
  const layers: ProjectionLayerDescriptor[] = []
  let layerNumber = 1

  if (options.includeBackground && scene.backgroundAssetId) {
    const asset = await resolver.resolveAsset(scene.backgroundAssetId, scene.assetSnapshotId)
    if (asset.type === 'background') {
      layers.push(toDescriptor(layerNumber++, 'background', asset, 0))
    }
  }

  const stickers = scene.objects
    .filter((object) => object.visible)
    .slice()
    .sort(compareByZIndex)

  for (const object of stickers) {
    const asset = await resolver.resolveAsset(object.assetId, scene.assetSnapshotId)
    layers.push(toDescriptor(layerNumber++, 'sticker', asset, object.zIndex))
  }

  return layers
}

function compareByZIndex(a: SceneObject, b: SceneObject): number {
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
  return a.objectId.localeCompare(b.objectId)
}

function toDescriptor(
  layerNumber: number,
  kind: ProjectionLayerKind,
  asset: AssetRecord,
  zIndex: number
): ProjectionLayerDescriptor {
  return {
    layerNumber,
    kind,
    assetId: asset.assetId,
    label: asset.nameZh || asset.nameEn || asset.assetId,
    imageUrl: asset.imageUrl,
    zIndex
  }
}

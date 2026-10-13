import type { PersonalAssetRecord, PersonalAssetVersionRecord, SceneDocument } from '@shared/contracts'
import { isPersonalAssetSourceRefFor } from '@shared/resource'
import { encodedImageFormat } from '@shared/resource/image-format'
import { validateImageIntake } from './canvas-intake'

type Resolver = (assetId: string, versionId: string) => Promise<{ asset: PersonalAssetRecord; version: PersonalAssetVersionRecord }>

/** Resolve the selected immutable version, not latest-version or rendered Canvas pixels.
 * Catalog-only elements retain their existing export path (undefined). A broken personal
 * source is an error, never permission to silently substitute a different input.
 */
export async function readPersonalElementInput(
  scene: SceneDocument, objectId: string, resolve: Resolver,
  read: typeof fetch = fetch
): Promise<Uint8Array | undefined> {
  const personal = [...scene.personalElements, ...(scene.corePattern ? [scene.corePattern] : [])]
    .find(item => item.objectId === objectId)
  if (!personal) {
    if (!scene.objects.some(item => item.objectId === objectId && item.visible)) throw new Error('选中元素不可用。')
    return undefined
  }
  if (!personal.visible) throw new Error('选中元素不可用。')
  const { asset, version } = await resolve(personal.personalAssetId, personal.versionId)
  if (asset.userId !== scene.userId || asset.personalAssetId !== personal.personalAssetId ||
      version.personalAssetId !== personal.personalAssetId || version.versionId !== personal.versionId ||
      !isPersonalAssetSourceRefFor(version.sourceImageRef, personal.personalAssetId, personal.versionId)) {
    throw new Error('素材原图与当前用户或固定版本不匹配。')
  }
  const response = await read(version.sourceImageRef)
  if (!response.ok) throw new Error('素材原图读取失败；未使用画布预览替代。')
  const bytes = new Uint8Array(await response.arrayBuffer()), format = encodedImageFormat(bytes)
  validateImageIntake(format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : '', bytes.length)
  if (!version.sourceImageRef.endsWith(`.${format}`)) throw new Error('素材原图编码与版本引用不一致。')
  return bytes
}

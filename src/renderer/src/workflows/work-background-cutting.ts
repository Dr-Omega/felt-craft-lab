import type { ProjectRecord } from '@shared/contracts'
import { artworkBackgroundColor } from '@shared/scene-background'
import { createCatalogResolver } from '../catalog/ywn-catalog'
import { loadProvidedPsdLayers } from '../projection/provided-psd-layers'
import { checkedPsdEdit, originalPsdEdit, paintProvidedPsd, providedPsdPack } from '../projection/provided-psd-artwork'
import { psdMaskContours } from '../projection/psd-mask-contours'
import { transformCuts, type CutPiece } from '../projection/cutting-layout'
import { assertSavedComposite, buildWorkDisplay } from './work-display'

/** Only selected artwork. UI paper never enters the background export paths. */
export async function prepareBackgroundCuts(work: ProjectRecord, mode: 'layers' | 'image', signal: AbortSignal, backgroundImage?: string): Promise<CutPiece[]> {
  const { scene } = work, { width, height } = scene.canvas
  const check = () => { if (signal.aborted) throw new Error('已取消图纸准备。') }
  const color = artworkBackgroundColor(scene.canvas)
  if (!scene.personalBackground && !scene.backgroundAssetId && !color) return []
  const frame = { width, height }
  const rectangle: CutPiece['rings'] = [[[0,0],[width,0],[width,height],[0,height],[0,0]]]
  check()
  if (mode === 'image') {
    const imageUrl = backgroundImage ?? (await buildWorkDisplay(work, signal)).layers.find(layer => layer.background)?.image
    check()
    if (!imageUrl) throw new Error('作品背景图片无法读取。')
    return [{ id:'background:image', color:'#FFFFFF', element:1, step:1, rings:rectangle, imageUrl, backgroundFrame:frame }]
  }
  if (!scene.personalBackground && !scene.backgroundAssetId) {
    return [{ id:'background:color', color:color!, element:1, step:1, rings:rectangle, backgroundFrame:frame }]
  }
  const resolver = createCatalogResolver()
  let edit
  if (scene.personalBackground) {
    const { personalAssetId, versionId } = scene.personalBackground
    const resolved = await resolver.resolvePersonalAsset!(personalAssetId, versionId)
    if (resolved.asset.userId !== scene.userId || resolved.asset.role !== 'background' || resolved.version.versionId !== versionId) throw new Error('背景版本或所属账号不匹配。')
    if (resolved.version.providedPsd) {
      edit = checkedPsdEdit(resolved.version.providedPsd)
      await assertSavedComposite(resolved.version.sourceImageRef, (await paintProvidedPsd(edit)).composite)
    }
  } else {
    const asset = await resolver.resolveAsset(scene.backgroundAssetId!, scene.assetSnapshotId)
    // Background catalog records predate preSplitDataUrl support. Match the
    // exact immutable image URL, never the semantic asset ID or a newer snapshot.
    const supplied = providedPsdPack('beijing')
    const pack = await loadProvidedPsdLayers(asset) ?? (asset.imageUrl === supplied.imageUrl ? supplied : undefined)
    if (pack) edit = originalPsdEdit(pack)
  }
  if (!edit) throw new Error('这个背景没有现成的 PSD 图层。可在爆炸图选择不要背景，按整张图片打印；不会自动运行拆分算法。')
  const pack = providedPsdPack(edit.sourceKey), painted = await paintProvidedPsd(edit)
  // Match the editor's cover crop. Keep at least native mask resolution: this is
  // framing the supplied layers, never segmenting, merging, or simplifying them.
  const cover = Math.max(width / pack.width, height / pack.height)
  const resolution = Math.max(1, 1 / cover)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * resolution); canvas.height = Math.ceil(height * resolution)
  const ctx = canvas.getContext('2d', { willReadFrequently:true })!
  const pieces: CutPiece[] = []
  if (color) pieces.push({id:'background:color', color, element:1, step:1, rings:rectangle, backgroundFrame:frame})
  for (const [index, source] of painted.layers.entries()) {
    check()
    const image = new Image(); image.src = source; await image.decode()
    ctx.clearRect(0,0,canvas.width,canvas.height)
    ctx.drawImage(image, (width - pack.width * cover) / 2 * resolution, (height - pack.height * cover) / 2 * resolution,
      pack.width * cover * resolution, pack.height * cover * resolution)
    const polygons = psdMaskContours(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height)
    // Entirely outside the saved cover crop: no visible cut, no invented shape.
    if (!polygons.length) continue
    const geometry = { width:canvas.width, height:canvas.height, sourceSha256:pack.source.sha256, resultSha256:pack.source.sha256,
      pieces:[{id:`background:${index}`, step:index + 1 + (color ? 1 : 0), color:edit.colors[index], polygons}] }
    pieces.push(...transformCuts(geometry,{left:width/2,top:height/2,scaleX:width/canvas.width,scaleY:height/canvas.height,angle:0},1)
      .map(piece => ({...piece,backgroundFrame:frame})))
  }
  check()
  if (!pieces.length) throw new Error('背景图层在当前画面范围内没有可导出的内容。')
  return pieces
}

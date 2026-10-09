import type { ProjectRecord, SceneObject, ScenePersonalTransformBase } from '@shared/contracts'
import { initialColors, validateColors } from '@shared/fabrication-colors'
import { createCatalogResolver } from '../catalog/ywn-catalog'
import { readCanvasRecolorLink } from '../fabrication/canvas-recolor'
import { recolorLayers } from '../fabrication/recolor'
import { loadResourceObjectUrl } from '../services/resource.service'

export interface WorkDisplayLayer {
  id: string
  label: string
  image: string
  background: boolean
  objectId?: string
  layerIndex?: number
}
export interface WorkDisplay { layers: WorkDisplayLayer[]; assemblies: string[]; width: number; height: number }

/** Scene ordering and element-internal ordering are separate. Never group by color. */
export function displayObjectOrder(scene: ProjectRecord['scene']) {
  return [
    ...(scene.corePattern?.visible ? [scene.corePattern] : []),
    ...[...scene.objects, ...scene.personalElements].filter(object => object.visible).sort((a, b) => a.zIndex - b.zIndex)
  ]
}

async function image(src: string): Promise<HTMLImageElement> {
  const value = new Image()
  // Same resource bridge as the editor: drawing custom-protocol URLs directly
  // would taint the canvas and break exports for catalog/personal images.
  const objectUrl = src.startsWith('felt-resource://') ? await loadResourceObjectUrl(src) : undefined
  try {
    value.src = objectUrl ?? src
    await value.decode()
    return value
  } finally { if (objectUrl) URL.revokeObjectURL(objectUrl) }
}

/** Read-only reconstruction from pinned personal versions. No global "last job" or latest colors. */
export async function buildWorkDisplay(work: ProjectRecord, signal?: AbortSignal): Promise<WorkDisplay> {
  const { scene } = work
  const { width, height } = scene.canvas
  const resolver = createCatalogResolver()
  const layers: WorkDisplayLayer[] = []
  const assemblies: string[] = []
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  const base = document.createElement('canvas'), frame = document.createElement('canvas')
  base.width = frame.width = width; base.height = frame.height = height
  const baseCtx = base.getContext('2d')!, frameCtx = frame.getContext('2d')!
  function check(): void { if (signal?.aborted) throw new Error('展示加载已取消。') }
  function record(layer: Omit<WorkDisplayLayer, 'image'>, commit = true, isolated?: string,
    paintAssembly?: (context: CanvasRenderingContext2D) => void): void {
    check()
    layers.push({ ...layer, image: isolated ?? canvas.toDataURL('image/png') })
    frameCtx.clearRect(0, 0, width, height)
    frameCtx.drawImage(base, 0, 0)
    if (paintAssembly) paintAssembly(frameCtx)
    else frameCtx.drawImage(canvas, 0, 0)
    assemblies.push(frame.toDataURL('image/png'))
    if (commit) { baseCtx.clearRect(0, 0, width, height); baseCtx.drawImage(frame, 0, 0) }
  }
  async function personal(item: { personalAssetId: string; versionId: string }) {
    const resolved = await resolver.resolvePersonalAsset!(item.personalAssetId, item.versionId)
    if (resolved.asset.userId !== scene.userId) throw new Error('个人素材与作品用户不匹配。')
    return resolved
  }
  if (scene.canvas.backgroundColor) {
    ctx.fillStyle = scene.canvas.backgroundColor
    ctx.fillRect(0, 0, width, height)
    record({ id: 'paper', label: '画布底色（不是制作底板）', background: true })
  }
  if (scene.personalBackground || scene.backgroundAssetId) {
    const ref = scene.personalBackground
      ? (await personal(scene.personalBackground)).version.sourceImageRef
      : (await resolver.resolveAsset(scene.backgroundAssetId!, scene.assetSnapshotId)).imageUrl
    const source = await image(ref)
    const scale = Math.max(width / source.width, height / source.height)
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(source, (width - source.width * scale) / 2, (height - source.height * scale) / 2, source.width * scale, source.height * scale)
    record({ id: 'background', label: '场景背景', background: true })
  }
  async function draw(src: string, object: SceneObject | ScenePersonalTransformBase,
    layer: Omit<WorkDisplayLayer, 'image'>, cumulative?: string, commit = true) {
    function transform(context: CanvasRenderingContext2D, source: HTMLImageElement) {
      context.save()
      context.translate(object.left, object.top)
      context.rotate(object.angle * Math.PI / 180)
      context.scale(object.scaleX, object.scaleY)
      context.drawImage(source, -source.width / 2, -source.height / 2)
      context.restore()
    }
    const source = await image(src)
    check()
    ctx.clearRect(0, 0, width, height)
    transform(ctx, source)
    const isolated = canvas.toDataURL('image/png')
    // Match Canvas: compose an element at native resolution BEFORE transforming.
    // Transforming each mask then composing introduces false antialiasing seams.
    const assembly = cumulative ? await image(cumulative) : source
    record(layer, commit, isolated, context => transform(context, assembly))
  }
  for (const object of displayObjectOrder(scene)) {
    check()
    if ('assetId' in object) {
      const asset = await resolver.resolveAsset(object.assetId, scene.assetSnapshotId)
      await draw(asset.imageUrl, object, { id: object.objectId, objectId: object.objectId, label: asset.nameZh + '（完整元素）', background: false })
      continue
    }
    const resolved = await personal(object)
    const link = readCanvasRecolorLink(object.versionId)
    if (!link) {
      await draw(resolved.version.sourceImageRef, object, { id: object.objectId, objectId: object.objectId, label: resolved.asset.name + '（未拆分元素）', background: false })
      continue
    }
    if (link.ownerUserId !== scene.userId) throw new Error('拆分图层与作品用户不匹配。')
    const job = await window.electronAPI.fabrication.resume(link.jobId)
    if (job.status !== 'complete' || !job.result || job.result.sourceSha256 !== link.sourceSha256) {
      throw new Error('已保存元素的拆分结果缺失或来源不匹配；没有使用其他任务代替。')
    }
    const view = job.result
    const colors = validateColors(link.colors, initialColors(view, link.binding))
    const masks: string[] = []
    try {
      for (const step of view.steps) {
        const asset = await window.electronAPI.fabrication.asset(job.id, step.asset)
        masks.push(URL.createObjectURL(new Blob([new Uint8Array(asset.bytes).buffer], { type: asset.mime })))
      }
      check()
      const painted = await recolorLayers(colors, masks, view.width, view.height)
      await assertSavedComposite(resolved.version.sourceImageRef, painted.composite)
      for (const layer of colors.layers) {
        await draw(painted.layers[layer.layerIndex], object, {
          id: object.objectId + ':' + layer.layerIndex, objectId: object.objectId, layerIndex: layer.layerIndex,
          label: resolved.asset.name + ' · 第 ' + (layer.layerIndex + 1) + ' 层 ' + layer.hex + ' · ' + layer.pieceIds.length + ' 块',
          background: false
        }, painted.assemblies[layer.layerIndex], layer.layerIndex === colors.layers.length - 1)
      }
    } finally { masks.forEach(url => URL.revokeObjectURL(url)) }
  }
  return { layers, assemblies, width, height }
}

/** A valid color document alone is not proof that it belongs to the pinned PNG. */
async function assertSavedComposite(savedRef: string, composite: string): Promise<void> {
  const saved = await image(savedRef), rebuilt = await image(composite)
  if (saved.width !== rebuilt.width || saved.height !== rebuilt.height) throw new Error('已保存素材与图层尺寸不一致。')
  const canvas = document.createElement('canvas'); canvas.width = saved.width; canvas.height = saved.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(saved, 0, 0)
  const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(rebuilt, 0, 0)
  const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3] || (a[i + 3] && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]))) {
      throw new Error('已保存素材与换色图层记录不一致；请返回画布检查，不使用错误图层替代。')
    }
  }
}

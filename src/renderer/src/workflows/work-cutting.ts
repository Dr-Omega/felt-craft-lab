import type { ProjectRecord } from '@shared/contracts'
import { initialColors, validateColors } from '@shared/fabrication-colors'
import { sameElementSource } from '@shared/fabrication-task-identity'
import { artworkBackgroundColor } from '@shared/scene-background'
import { createCatalogResolver } from '../catalog/ywn-catalog'
import { readCanvasRecolorLink } from '../fabrication/canvas-recolor'
import { readPersonalElementInput } from '../fabrication/element-input'
import { assertSavedComposite, displayObjectOrder } from './work-display'
import { transformCuts, type CutPiece } from '../projection/cutting-layout'
import { loadProvidedPsdLayers } from '../projection/provided-psd-layers'
import { originalPsdEdit, checkedPsdEdit, paintProvidedPsd, providedPsdGeometry } from '../projection/provided-psd-artwork'

/** Read existing layered inputs only. PDF layout never starts or retries image decomposition. */
export async function prepareWorkCuts(work: ProjectRecord, progress: (text: string) => void, signal: AbortSignal): Promise<CutPiece[]> {
  const scene = work.scene, resolver = createCatalogResolver(), api = window.electronAPI.fabrication
  const pieces: CutPiece[] = []
  const check = () => { if (signal.aborted) throw new Error('已取消图纸准备。') }
  const objects = displayObjectOrder(scene)
  const firstElementNumber = artworkBackgroundColor(scene.canvas) || scene.personalBackground || scene.backgroundAssetId ? 2 : 1
  if (!objects.length) throw new Error('没有可排版的前景素材。画布底色与场景背景不作为裁片。')
  for (const [index, object] of objects.entries()) {
    check()
    // Authored PSD masks bypass every algorithm/job endpoint, including list/resume.
    const psdEdit = 'assetId' in object
      ? await (async () => {
          const asset = await resolver.resolveAsset(object.assetId, scene.assetSnapshotId)
          const pack = await loadProvidedPsdLayers(asset)
          return pack ? originalPsdEdit(pack) : undefined
        })()
      : await (async () => {
          const resolved = await resolver.resolvePersonalAsset!(object.personalAssetId, object.versionId)
          if (resolved.asset.userId !== scene.userId) throw new Error('个人素材不属于当前账号。')
          if (!resolved.version.providedPsd) return undefined
          const edit = checkedPsdEdit(resolved.version.providedPsd)
          await assertSavedComposite(resolved.version.sourceImageRef, (await paintProvidedPsd(edit)).composite)
          return edit
        })()
    if (psdEdit) {
      progress(`正在读取 PSD 原始图层 ${index + 1} / ${objects.length}…`)
      const geometry = await providedPsdGeometry(psdEdit)
      check(); pieces.push(...transformCuts(geometry, object, index + firstElementNumber)); continue
    }
    const link = 'versionId' in object ? readCanvasRecolorLink(object.versionId) : undefined
    let job, colors
    if (link) {
      if (link.ownerUserId !== scene.userId) throw new Error('图层关联不属于当前账号。')
      job = await api.resume(link.jobId)
      if (!job.result || job.status !== 'complete' || job.result.sourceSha256 !== link.sourceSha256) throw new Error('已保存图层来源缺失或不一致。')
      colors = validateColors(link.colors, initialColors(job.result, link.binding))
    } else {
      progress(`正在读取素材 ${index + 1} / ${objects.length}…`)
      let bytes: Uint8Array
      if ('assetId' in object) {
        const asset = await resolver.resolveAsset(object.assetId, scene.assetSnapshotId)
        const response = await fetch(asset.imageUrl)
        if (!response.ok) throw new Error('素材原图读取失败。')
        bytes = new Uint8Array(await response.arrayBuffer())
      } else {
        bytes = (await readPersonalElementInput(scene, object.objectId, resolver.resolvePersonalAsset!.bind(resolver)))!
      }
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(v => v.toString(16).padStart(2, '0')).join('')
      const binding = { scene, objectId: object.objectId }
      // Existing validated jobs can be reused only for this exact element source AND input bytes.
      job = (await api.list()).filter(j => j.status === 'complete' && j.result?.sourceSha256 === hash && sameElementSource(j.binding, binding)).at(-1)
      if (!job) throw new Error('这份素材暂无现成分层。当前仅保留 PDF 排版，不会自动运行拆分算法。')
      if (job.status !== 'complete' || !job.result) throw new Error(job.message)
      if (job.result.sourceSha256 !== hash) throw new Error('裁片与素材原图不匹配。')
      colors = initialColors(job.result)
    }
    check()
    const geometry = await api.cuttingGeometry(job.id)
    if (geometry.resultSha256 !== colors.resultSha256) throw new Error('裁片轮廓与颜色版本不匹配。')
    const byPiece = new Map(colors.layers.flatMap(layer => layer.pieceIds.map(id => [id, layer.hex] as const)))
    pieces.push(...transformCuts(geometry, object, index + firstElementNumber, byPiece))
  }
  check(); return pieces
}

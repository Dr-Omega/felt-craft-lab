import index from '../../../../assets/generated/provided-psd-20261017.json'
import { validProvidedPsdEdit, type ProvidedPsdEdit, type ProvidedPsdKey } from '@shared/provided-psd'
import { validHex, type LayerColors } from '@shared/fabrication-colors'
import type { CuttingGeometry } from '@shared/cutting-pattern'
import { parseProvidedPsdLayers, type ProvidedPsdLayers } from './provided-psd-layers'
import { psdMaskContours } from './psd-mask-contours'
import { tintPixels } from '../fabrication/recolor'

export function providedPsdName(key: ProvidedPsdKey): string {
  return { fuwa: '福娃', hongbao: '红包', jiaozi: '饺子', denglong: '灯笼', beijing: '背景' }[key]
}

export function providedPsdPack(key: ProvidedPsdKey): ProvidedPsdLayers {
  const raw = index.assets[key]
  if (!raw) throw new Error('找不到对应的 PSD 原始素材。')
  return parseProvidedPsdLayers(raw, { imageUrl: raw.imageUrl,
    preSplitDataUrl: `felt-resource://material/${index.snapshotId}/provided/${key}/layers.json` })
}
export function originalPsdEdit(pack: ProvidedPsdLayers): ProvidedPsdEdit {
  return { schemaVersion: 'provided-psd-edit/1', sourceKey: pack.key, sourceSha256: pack.source.sha256,
    colors: pack.layers.filter(layer => layer.effectiveVisible).map(layer => layer.dominantColor) }
}
export function checkedPsdEdit(raw: ProvidedPsdEdit): ProvidedPsdEdit {
  if (!validProvidedPsdEdit(raw)) throw new Error('PSD 逐层颜色记录无效。')
  const canonical = originalPsdEdit(providedPsdPack(raw.sourceKey))
  if (raw.sourceSha256 !== canonical.sourceSha256 || raw.colors.length !== canonical.colors.length) throw new Error('PSD 换色记录与原始图层不匹配。')
  return structuredClone(raw)
}
export function psdLayerColors(edit: ProvidedPsdEdit): LayerColors {
  checkedPsdEdit(edit)
  const pack = providedPsdPack(edit.sourceKey)
  return { schemaVersion: 'fabrication-layer-colors/1', resultSha256: pack.source.sha256, revision: 0, binding: null,
    layers: pack.layers.filter(layer => layer.effectiveVisible).map((layer, i) => ({ layerId: `${pack.source.sha256}:${layer.id}`,
      layerIndex: i, pieceIds: [layer.id], originalColorSlotId: layer.id, originalHex: layer.dominantColor, hex: edit.colors[i] })) }
}
const sources = new Map<string, Promise<string>>()
/** Read exact packaged bytes, verifying their immutable manifest identity before use. */
export function psdImageDataUrl(ref: string, sha256?: string): Promise<string> {
  const key = ref + ':' + (sha256 ?? '')
  let pending = sources.get(key)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(ref)
      if (!response.ok) throw new Error('PSD 图层图片读取失败。')
      const bytes = await response.arrayBuffer()
      if (sha256) {
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
        if (actual !== sha256) throw new Error('PSD 图层图片与来源哈希不匹配。')
      }
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('PSD 图像解码失败。'))
        reader.readAsDataURL(new Blob([bytes], { type: 'image/png' }))
      })
    })().catch(error => { sources.delete(key); throw error })
    sources.set(key, pending)
  }
  return pending
}
async function image(src: string) { const value = new Image(); value.src = src; await value.decode(); return value }
function canvas(width: number, height: number) { const value = document.createElement('canvas'); value.width = width; value.height = height; return value }
const geometryCache = new Map<string, Promise<CuttingGeometry>>()
/** Each PSD layer is already a color mask. Contouring does not invoke the fabrication service. */
export async function providedPsdGeometry(edit: ProvidedPsdEdit): Promise<CuttingGeometry> {
  checkedPsdEdit(edit)
  const pack = providedPsdPack(edit.sourceKey), key = pack.source.sha256
  let pending = geometryCache.get(key)
  if (!pending) {
    pending = (async () => {
      const surface = canvas(pack.width, pack.height), ctx = surface.getContext('2d', { willReadFrequently: true })!
      const pieces: CuttingGeometry['pieces'] = []
      for (const [i, layer] of pack.layers.filter(layer => layer.effectiveVisible).entries()) {
        const source = await image(await psdImageDataUrl(layer.imageUrl, layer.imageSha256))
        if (source.width !== pack.width || source.height !== pack.height) throw new Error('PSD 图层尺寸不一致。')
        ctx.clearRect(0, 0, pack.width, pack.height); ctx.drawImage(source, 0, 0)
        const polygons = psdMaskContours(ctx.getImageData(0, 0, pack.width, pack.height).data, pack.width, pack.height)
        if (!polygons.length) throw new Error('PSD 可见图层没有可裁剪区域。')
        pieces.push({ id: layer.id, step: i + 1, color: layer.dominantColor, polygons })
      }
      return { width: pack.width, height: pack.height, resultSha256: key, sourceSha256: key, pieces }
    })().catch(error => { geometryCache.delete(key); throw error })
    geometryCache.set(key, pending)
  }
  const result = structuredClone(await pending)
  result.pieces.forEach((piece, i) => { piece.color = edit.colors[i] })
  return result
}
export async function paintProvidedPsd(raw: ProvidedPsdEdit): Promise<{ layers: string[]; assemblies: string[]; composite: string }> {
  const edit = checkedPsdEdit(raw), pack = providedPsdPack(edit.sourceKey)
  const visible = pack.layers.filter(layer => layer.effectiveVisible)
  const originals = await Promise.all(visible.map(layer => psdImageDataUrl(layer.imageUrl, layer.imageSha256)))
  if (edit.colors.every((hex, i) => hex === visible[i].dominantColor)) {
    // No gratuitous recoloring or re-encoding of the artist's original antialiased edges.
    const assemblies = await Promise.all(visible.map(layer => psdImageDataUrl(layer.assemblyUrl!)))
    return { layers: originals, assemblies, composite: await psdImageDataUrl(pack.imageUrl, pack.imageSha256) }
  }
  const surface = canvas(pack.width, pack.height), composite = canvas(pack.width, pack.height)
  const ctx = surface.getContext('2d', { willReadFrequently: true })!, paint = composite.getContext('2d')!
  const layers: string[] = [], assemblies: string[] = []
  for (const [i, src] of originals.entries()) {
    ctx.clearRect(0, 0, pack.width, pack.height); ctx.drawImage(await image(src), 0, 0)
    if (edit.colors[i] !== visible[i].dominantColor) {
      const pixels = ctx.getImageData(0, 0, pack.width, pack.height)
      pixels.data.set(tintPixels(pixels.data, validHex(edit.colors[i]))); ctx.putImageData(pixels, 0, 0)
    }
    layers.push(surface.toDataURL('image/png')); paint.drawImage(surface, 0, 0)
    assemblies.push(composite.toDataURL('image/png'))
  }
  return { layers, assemblies, composite: assemblies.at(-1)! }
}

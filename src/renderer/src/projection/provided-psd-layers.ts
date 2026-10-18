import type { AssetRecord } from '@shared/contracts'
import type { ProvidedPsdKey } from '@shared/provided-psd'

export interface ProvidedPsdLayer {
  id: string
  name: string
  paintOrder: number
  visible: boolean
  effectiveVisible: boolean
  imageUrl: string
  imageSha256: string
  dominantColor: string
  assemblyUrl?: string
}
export interface ProvidedPsdLayers {
  schemaVersion: 'provided-psd-layers/1'
  key: ProvidedPsdKey
  width: number
  height: number
  imageUrl: string
  imageSha256: string
  source: { filename: string; sha256: string; width: number; height: number }
  layers: ProvidedPsdLayer[]
}

/** Original authored layers, not inferred fabrication or color segmentation. */
export function parseProvidedPsdLayers(raw: unknown, asset: Pick<AssetRecord, 'imageUrl' | 'preSplitDataUrl'>): ProvidedPsdLayers {
  const fail = (): never => { throw new Error('PSD 原始图层数据与素材不匹配。') }
  if (!raw || typeof raw !== 'object' || !asset.preSplitDataUrl) return fail()
  const value = raw as Record<string, any>
  const positive = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 16384
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  if (value.schemaVersion !== 'provided-psd-layers/1' || value.imageUrl !== asset.imageUrl || !hash(value.imageSha256) ||
      !positive(value.width) || !positive(value.height) || !value.source || !hash(value.source.sha256) ||
      !positive(value.source.width) || !positive(value.source.height) || !Array.isArray(value.layers) ||
      value.layers.length < 1 || value.layers.length > 512) return fail()
  const directory = asset.preSplitDataUrl.slice(0, asset.preSplitDataUrl.lastIndexOf('/') + 1)
  const ids = new Set<string>()
  for (const [i, layer] of value.layers.entries()) {
    const number = String(i).padStart(3, '0')
    if (!layer || layer.id !== `psd-${number}` || ids.has(layer.id) || layer.paintOrder !== i ||
        typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 256 ||
        typeof layer.visible !== 'boolean' || typeof layer.effectiveVisible !== 'boolean' ||
        (!layer.visible && layer.effectiveVisible) || layer.kind !== 'pixel' || layer.opacity !== 255 || layer.blendMode !== 'normal' ||
        layer.imageUrl !== `${directory}layer-${number}.png` || !hash(layer.imageSha256) ||
        (layer.effectiveVisible && (layer.assemblyUrl !== `${directory}assembly-${number}.png` || !/^#[0-9A-F]{6}$/.test(layer.dominantColor)))) return fail()
    ids.add(layer.id)
  }
  if (!value.layers.some((l: ProvidedPsdLayer) => l.effectiveVisible)) return fail()
  return value as ProvidedPsdLayers
}

export async function loadProvidedPsdLayers(asset: AssetRecord): Promise<ProvidedPsdLayers | undefined> {
  if (!asset.preSplitDataUrl) return undefined
  const response = await fetch(asset.preSplitDataUrl)
  if (!response.ok) throw new Error('PSD 原始图层暂时无法读取。')
  return parseProvidedPsdLayers(await response.json(), asset)
}

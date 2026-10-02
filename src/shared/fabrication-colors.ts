import { validateSceneDocument, type SceneDocument } from './contracts'
import type { FabricationView } from './fabrication-desktop'

export interface SceneBinding { scene: SceneDocument; objectId?: string }
export interface LayerColor {
  layerId: string
  layerIndex: number // 0 is the bottom work layer, NOT material thickness.
  pieceIds: string[]
  originalColorSlotId: string
  originalHex: string
  hex: string
}
export interface LayerColors {
  schemaVersion: 'fabrication-layer-colors/1'
  resultSha256: string
  revision: number
  binding: SceneBinding | null
  layers: LayerColor[]
}
export function validateBinding(raw: unknown): SceneBinding | null {
  if (raw === undefined || raw === null) return null
  const value = raw as SceneBinding
  const checked = validateSceneDocument(value.scene)
  if (!checked.ok) throw new Error('画布来源无效。')
  if (value.objectId !== undefined && (typeof value.objectId !== 'string' ||
      ![...checked.value.objects, ...checked.value.personalElements, ...(checked.value.corePattern ? [checked.value.corePattern] : [])]
        .some(item => item.objectId === value.objectId))) throw new Error('来源元素不存在。')
  return { scene: checked.value, ...(value.objectId === undefined ? {} : { objectId: value.objectId }) }
}
export function rgbHex(rgb: number[]): string {
  if (rgb.length !== 3 || rgb.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('无效 RGB。')
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}
export function validHex(value: unknown): string {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) throw new Error('颜色必须是六位 RGB 色值。')
  return value.toUpperCase()
}
export function initialColors(view: FabricationView, binding: SceneBinding | null = null): LayerColors {
  const seen = new Set<string>()
  return { schemaVersion: 'fabrication-layer-colors/1', resultSha256: view.resultSha256, revision: 0, binding,
    layers: view.steps.map((step, index) => {
      if (step.step !== index + 1 || !step.pieceIds.length || new Set(step.pieceIds).size !== step.pieceIds.length || step.pieceIds.some(id => seen.has(id))) throw new Error('制作层顺序或裁片绑定无效。')
      step.pieceIds.forEach(id => seen.add(id))
      return { layerId: `${view.resultSha256}:layer:${index}`, layerIndex: index, pieceIds: [...step.pieceIds],
        originalColorSlotId: step.colorSlotId, originalHex: rgbHex(step.rgb), hex: rgbHex(step.rgb) }
    }) }
}
/** Accept colors only. Geometry, membership, order and source identity are immutable. */
export function validateColors(raw: unknown, canonical: LayerColors): LayerColors {
  const value = raw as LayerColors
  if (!value || value.schemaVersion !== canonical.schemaVersion || value.resultSha256 !== canonical.resultSha256 ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      JSON.stringify(value.binding) !== JSON.stringify(canonical.binding) || !Array.isArray(value.layers) ||
      value.layers.length !== canonical.layers.length) throw new Error('换色记录与来源不匹配。')
  return { ...canonical, revision: value.revision, layers: canonical.layers.map((layer, i) => {
    const actual = value.layers[i]
    if (!actual || actual.layerId !== layer.layerId || actual.layerIndex !== layer.layerIndex ||
        actual.originalHex !== layer.originalHex || actual.originalColorSlotId !== layer.originalColorSlotId ||
        JSON.stringify(actual.pieceIds) !== JSON.stringify(layer.pieceIds)) throw new Error('不允许换色修改层序或裁片绑定。')
    return { ...layer, hex: validHex(actual.hex) }
  }) }
}

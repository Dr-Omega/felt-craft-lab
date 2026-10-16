import { createHash } from 'node:crypto'
import { canonicalPayloadJson } from '@shared/contracts/fabrication-validation'
import { initialColors } from '@shared/fabrication-colors'
import type { FabricationView } from '@shared/fabrication-desktop'
import type { CuttingGeometry, CutPolygon } from '@shared/cutting-pattern'

/** Validate the exact persisted result and its display schedule before releasing contours. */
export function readCuttingGeometry(raw: unknown, view: FabricationView): CuttingGeometry {
  const fail = (): never => { throw new Error('裁片轮廓与已验证结果不一致，请重新准备图层。') }
  const result = raw as { schemaVersion: string; identity: { sha256: string }; payload: {
    input: { coordinates: { canonicalFrameId: string; frames: { id: string; bounds: number[]; yDirection: string }[]; transforms: { matrix: number[] }[] } }
    pieces: { id: string; colorSlotId: string; rgb: number[]; full: { type: string; coordinates: unknown } }[]
    wholeSilhouetteBase?: { rule: string; basePieceIds: string[]; selectedColorSlotId: string; supportDomain: { type: string; coordinates: unknown } }
  } }
  if (!result || result.schemaVersion !== 'fabrication.layered-result/1' || !result.payload ||
      view.geometryStatus !== 'PASS' || result.identity?.sha256 !== view.resultSha256 ||
      createHash('sha256').update(canonicalPayloadJson(result.payload)).digest('hex') !== view.resultSha256) fail()
  if (!(view.width > 0 && view.height > 0)) fail()
  const coordinates = result.payload.input?.coordinates
  const frame = coordinates?.frames.find(f => f.id === coordinates.canonicalFrameId)
  // Desktop rendering currently uses pixel-aligned canonical coordinates. Fail closed if that contract changes.
  if (!frame || frame.yDirection !== 'DOWN' || JSON.stringify(frame.bounds) !== JSON.stringify([0, 0, view.width, view.height]) ||
      !coordinates.transforms.length || coordinates.transforms.some(t => JSON.stringify(t.matrix) !== '[1,0,0,1,0,0]')) fail()
  const colors = initialColors(view)
  if (!Array.isArray(result.payload.pieces) || result.payload.pieces.length !== view.pieceCount ||
      new Set(result.payload.pieces.map(p => p.id)).size !== view.pieceCount) fail()
  const polygonsOf = (shape: { type: string; coordinates: unknown }): CutPolygon[] => {
    const polygons = (shape?.type === 'Polygon' ? [shape.coordinates] : shape?.type === 'MultiPolygon' ? shape.coordinates : null) as CutPolygon[] | null
    if (!Array.isArray(polygons) || !polygons.length) return fail()
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) fail()
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(pt => !Array.isArray(pt) || pt.length !== 2 || pt.some(n => !Number.isFinite(n))) ||
            ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) fail()
        if (!ring.reduce((sum, pt, i) => i ? sum + ring[i - 1][0] * pt[1] - pt[0] * ring[i - 1][1] : sum, 0)) fail()
      }
    }
    return polygons
  }
  const seen = new Set<string>()
  const pieces = colors.layers.flatMap(layer => layer.pieceIds.map(id => {
    const p = result.payload.pieces.find(piece => piece.id === id)
    if (!p || p.colorSlotId !== layer.originalColorSlotId || JSON.stringify(p.rgb) !== JSON.stringify(view.steps[layer.layerIndex].rgb)) return fail()
    const polygons = polygonsOf(p.full)
    seen.add(id)
    return { id, step: layer.layerIndex + 1, color: layer.hex, polygons }
  }))
  if (seen.size !== view.pieceCount) fail()
  const base = result.payload.wholeSilhouetteBase
  let backing: CuttingGeometry['backing']
  if (base) {
    if (base.rule !== 'whole-silhouette-base/1' || !Array.isArray(base.basePieceIds) || !base.basePieceIds.length ||
        new Set(base.basePieceIds).size !== base.basePieceIds.length || base.basePieceIds.some(id => {
          const piece = result.payload.pieces.find(p => p.id === id)
          return !piece || piece.colorSlotId !== base.selectedColorSlotId
        })) fail()
    // This supportDomain is the exact independently verified union, bound by the canonical result hash.
    backing = { pieceIds: [...base.basePieceIds], polygons: polygonsOf(base.supportDomain) }
  }
  return { resultSha256: view.resultSha256, sourceSha256: view.sourceSha256, width: view.width, height: view.height, pieces, ...(backing ? { backing } : {}) }
}

import type { CutPoint, CutPolygon, CuttingGeometry } from '@shared/cutting-pattern'
import type { SubjectSizeChoice } from './subject-size'
import { PRINT_LABEL_SPACE_MM, PRINT_MARGIN_MM } from './print-settings'

export interface CutPiece { id: string; color: string; step: number; element: number; rings: CutPolygon
  imageUrl?: string; backgroundFrame?: { width:number; height:number } }
export interface PlacedCut extends CutPiece { number: number; x: number; y: number; width: number; height: number }
export interface CutLabel { element: number; step: number; x: number; y: number }
export interface CuttingPage { pieces: PlacedCut[]; labels: CutLabel[]; landscape?: boolean }
export interface CuttingPlan { pages: CuttingPage[]; scale: number; widthMm: number; heightMm: number; pieceCount: number }
/** Scene element order, then that element's bottom-to-top making step. No cut serial. */
export function cuttingLabel(piece: Pick<CutPiece, 'element' | 'step'>): string { return `${piece.element}-${piece.step}` }
export interface CutTransform { left: number; top: number; scaleX: number; scaleY: number; angle: number }
export function transformCuts(geometry: CuttingGeometry, transform: CutTransform, element: number, colors?: Map<string, string>): CutPiece[] {
  const { left, top, scaleX, scaleY, angle } = transform
  if ([left, top, scaleX, scaleY, angle].some(v => !Number.isFinite(v)) || !scaleX || !scaleY) throw new Error('元素尺寸或位置无效。')
  const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180)
  return geometry.pieces.flatMap(piece => piece.polygons.map((polygon, i) => ({
    id: `${element}:${piece.id}:${i}`, color: colors?.get(piece.id) ?? piece.color, step: piece.step, element,
    rings: polygon.map(ring => ring.map(([px, py]): CutPoint => {
      const x = (px - geometry.width / 2) * scaleX, y = (py - geometry.height / 2) * scaleY
      return [left + c * x - s * y, top + s * x + c * y]
    }))
  })))
}
function bounds(rings: CutPolygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const ring of rings) for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('裁片坐标无效。')
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (!(maxX > minX && maxY > minY)) throw new Error('裁片轮廓为空。')
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}
/** Layout only: one uniform scale, with no splitting, absorption, hole filling or contour correction. */
export function planCuttingPages(pieces: CutPiece[], size: SubjectSizeChoice): CuttingPlan {
  if (!pieces.length) throw new Error('没有可导出的裁片，请先准备拆分图层。')
  const all = bounds(pieces.flatMap(piece => piece.rings))
  const frame = pieces.find(piece => piece.backgroundFrame)?.backgroundFrame ?? all
  if (!(frame.width > 0 && frame.height > 0)) throw new Error('作品尺寸无效。')
  const requestedScale = size.boundsMm ? Math.min(size.boundsMm.width / frame.width, size.boundsMm.height / frame.height) : size.targetLongEdgeMm / Math.max(frame.width, frame.height)
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) throw new Error('成品尺寸无效。')
  const groups = new Map<string, { piece: CutPiece; number: number }[]>()
  pieces.forEach((piece, index) => {
    const color = piece.color.toUpperCase()
    if (!/^#[\dA-F]{6}$/.test(color)) throw new Error('裁片颜色无效。')
    const key = cuttingLabel(piece), group = groups.get(key) ?? []
    group.push({ piece: { ...piece, color }, number: index + 1 }); groups.set(key, group)
  })
  const layers = [...groups.values()].map(group => ({ group, box:bounds(group.flatMap(item => item.piece.rings)) }))
  const margin = PRINT_MARGIN_MM, labelSpace = PRINT_LABEL_SPACE_MM
  // Pick ONE paper orientation, then cap ONE scene-to-mm scale before packing.
  // A wide/tall layer must shrink the whole work, never just itself or its page.
  const landscape = frame.width > frame.height && layers.some(layer => layer.box.width * requestedScale > 210 - 2 * margin + 1e-8)
  const pageWidth = landscape ? 297 : 210, pageHeight = landscape ? 210 : 297
  const right = pageWidth - margin, bottom = pageHeight - margin
  const innerWidth = pageWidth - 2 * margin, innerHeight = pageHeight - 2 * margin - labelSpace
  const maxWidth = Math.max(frame.width,...layers.map(layer => layer.box.width))
  const maxHeight = Math.max(frame.height,...layers.map(layer => layer.box.height))
  const scale = Math.min(requestedScale, innerWidth / maxWidth, innerHeight / maxHeight)
  const ordered = layers.map(({group,box}) => {
    const { element, step } = group[0].piece
    const width = box.width * scale, height = box.height * scale
    return { element, step, width, height, pieces: group.map(({ piece, number }): PlacedCut => {
      const own = bounds(piece.rings)
      return { ...piece, number, x: (own.minX - box.minX) * scale, y: (own.minY - box.minY) * scale,
        width: own.width * scale, height: own.height * scale,
        rings: piece.rings.map(ring => ring.map(([x, y]): CutPoint => [(x - own.minX) * scale, (y - own.minY) * scale])) }
    }) }
  }).sort((a, b) => a.element - b.element || a.step - b.step)
  // Process each element's layers together, without color/page breaks. Reuse row
  // space before adding rows or paper; never change a cut's scale or orientation.
  interface Shelf { x: number; y: number; height: number }
  const sheets: { page: CuttingPage; shelves: Shelf[] }[] = []
  for (const layer of ordered) {
    // Keep the original relative positions of disconnected cuts in one layer,
    // with one shared label. Do not scatter tiny islands into numbered rows.
    const width = Math.max(layer.width, cuttingLabel(layer).length * 2 + 1)
    const height = layer.height + labelSpace
    const place = (page: CuttingPage, x: number, y: number) => {
      page.pieces.push(...layer.pieces.map(piece => ({ ...piece, x: piece.x + x, y: piece.y + y })))
      page.labels.push({ element: layer.element, step: layer.step, x, y: y + layer.height + 4 })
    }
    let placed = false
    for (const sheet of sheets) {
      for (const [index, shelf] of sheet.shelves.entries()) {
        const lastRow = index === sheet.shelves.length - 1
        if (shelf.x + width > right + 1e-8 || (!lastRow && height > shelf.height + 1e-8) || shelf.y + Math.max(shelf.height, height) > bottom + 1e-8) continue
        place(sheet.page, shelf.x, shelf.y)
        shelf.x += width + 6; shelf.height = Math.max(shelf.height, height)
        placed = true; break
      }
      if (placed) break
      const last = sheet.shelves.at(-1)
      const y = last ? last.y + last.height + 6 : margin
      if (y + height > bottom + 1e-8) continue
      sheet.shelves.push({ x: margin + width + 6, y, height })
      place(sheet.page, margin, y)
      placed = true; break
    }
    if (!placed) {
      const page: CuttingPage = { pieces: [], labels: [], ...(landscape ? { landscape:true } : {}) }
      place(page, margin, margin)
      sheets.push({ page, shelves: [{ x: margin + width + 6, y: margin, height }] })
    }
  }
  const pages = sheets.map(sheet => sheet.page)
  return { pages, scale, widthMm: frame.width * scale, heightMm: frame.height * scale, pieceCount: pieces.length }
}
export function cutPath(piece: PlacedCut): string {
  return piece.rings.map(ring => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x + piece.x},${y + piece.y}`).join(' ') + ' Z').join(' ')
}

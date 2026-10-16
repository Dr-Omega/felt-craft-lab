import type { CutPoint, CutPolygon, CuttingGeometry } from '@shared/cutting-pattern'
import type { SubjectSizeChoice } from './subject-size'

export interface CutPiece { id: string; color: string; step: number; element: number; rings: CutPolygon }
export interface PlacedCut extends CutPiece { number: number; x: number; y: number; width: number; height: number }
export interface CuttingPage { color: string; pieces: PlacedCut[] }
export interface CuttingPlan { pages: CuttingPage[]; scale: number; widthMm: number; heightMm: number; pieceCount: number }
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
  const scale = size.boundsMm ? Math.min(size.boundsMm.width / all.width, size.boundsMm.height / all.height) : size.targetLongEdgeMm / Math.max(all.width, all.height)
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('成品尺寸无效。')
  const groups = new Map<string, PlacedCut[]>()
  pieces.forEach((piece, index) => {
    const color = piece.color.toUpperCase()
    if (!/^#[\dA-F]{6}$/.test(color)) throw new Error('裁片颜色无效。')
    const box = bounds(piece.rings), width = box.width * scale, height = box.height * scale
    // A4 margins 12 mm, header 30 mm, footer starts at 273 mm; 6 mm label beneath each piece.
    if (width > 186 || height + 6 > 237) throw new Error(`裁片 ${index + 1} 超过 A4 可打印区域，请选择更小的成品尺寸；不会单独缩小该裁片。`)
    const item: PlacedCut = { ...piece, color, number: index + 1, x: 0, y: 0, width, height,
      rings: piece.rings.map(ring => ring.map(([x, y]): CutPoint => [(x - box.minX) * scale, (y - box.minY) * scale])) }
    const group = groups.get(color) ?? []; group.push(item); groups.set(color, group)
  })
  const pages: CuttingPage[] = []
  for (const [color, group] of groups) {
    let page: CuttingPage = { color, pieces: [] }, x = 12, y = 30, rowHeight = 0
    pages.push(page)
    for (const piece of group) {
      if (x + piece.width > 198 + 1e-8) { x = 12; y += rowHeight + 6; rowHeight = 0 }
      if (y + piece.height + 6 > 267 + 1e-8) { page = { color, pieces: [] }; pages.push(page); x = 12; y = 30; rowHeight = 0 }
      page.pieces.push({ ...piece, x, y })
      x += Math.max(piece.width, 27) + 6; rowHeight = Math.max(rowHeight, piece.height + 6)
    }
  }
  return { pages, scale, widthMm: all.width * scale, heightMm: all.height * scale, pieceCount: pieces.length }
}
export function cutPath(piece: PlacedCut): string {
  return piece.rings.map(ring => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x + piece.x},${y + piece.y}`).join(' ') + ' Z').join(' ')
}

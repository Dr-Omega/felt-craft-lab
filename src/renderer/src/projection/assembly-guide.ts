import type { WorkDisplay } from '../workflows/work-display'
import { cuttingLabel, type CutPiece } from './cutting-layout'

export interface GuideBounds { x: number; y: number; width: number; height: number }
export interface AssemblyStep {
  label: string
  /** Only the newly added making layer / complete element, in saved coordinates. */
  added: CutPiece[]
  /** Cumulative layers, never the re-packed cutting-page coordinates. */
  pieces: CutPiece[]
  imageUrl?: string
}
export interface AssemblyGroup {
  kind: 'element' | 'scene'
  title: string
  bounds: GuideBounds
  steps: AssemblyStep[]
}
export interface AssemblyGuide { groups: AssemblyGroup[] }

export function guideBounds(pieces: CutPiece[]): GuideBounds {
  let x = Infinity, y = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const piece of pieces) for (const ring of piece.rings) for (const [px, py] of ring) {
    x = Math.min(x, px); y = Math.min(y, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py)
  }
  const width = maxX - x, height = maxY - y
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('叠放示意图的图层范围无效。')
  return { x, y, width, height }
}

/** PDF-only instructions. No new geometry, colors, segmentation, or UI state. */
export function buildAssemblyGuide(cuts: CutPiece[], display: WorkDisplay): AssemblyGuide {
  if (!display.layers.length || display.layers.length !== display.assemblies.length) throw new Error('叠放示意图与作品图层不一致。')
  if (!(display.width > 0 && display.height > 0)) throw new Error('叠放示意图的作品尺寸无效。')
  const groups: AssemblyGroup[] = []
  const byElement = new Map<number, CutPiece[]>()
  for (const piece of cuts) {
    const group = byElement.get(piece.element) ?? []
    group.push(piece); byElement.set(piece.element, group)
  }
  // displayObjectOrder is also used by prepareWorkCuts; keep the exact same IDs,
  // including the real background even when it is printed as one intact image.
  if (byElement.size !== display.layers.length || [...byElement.keys()].some(n => n < 1 || n > display.layers.length)) {
    throw new Error('裁片编号与作品元素不一致，请重新准备图纸。')
  }
  for (const [index, layer] of display.layers.entries()) {
    const element = index + 1, pieces = byElement.get(element)!
    // An intact printed background needs no internal making instructions.
    if (layer.background && pieces.some(piece => piece.imageUrl)) continue
    const steps: AssemblyStep[] = [], accumulated: CutPiece[] = []
    for (const step of [...new Set(pieces.map(piece => piece.step))].sort((a, b) => a - b)) {
      const added = pieces.filter(piece => piece.step === step)
      accumulated.push(...added)
      steps.push({ label: cuttingLabel({ element, step }), added, pieces: [...accumulated] })
    }
    groups.push({ kind: 'element', title: `${element} · ${layer.label}`, bounds: guideBounds(pieces), steps })
  }
  groups.push({ kind: 'scene', title: '整体叠放', bounds: { x: 0, y: 0, width: display.width, height: display.height },
    steps: display.layers.map((_, index) => ({ label: String(index + 1), added: byElement.get(index + 1)!,
      pieces: [], imageUrl: display.assemblies[index] })) })
  return { groups }
}

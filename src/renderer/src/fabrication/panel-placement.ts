export interface ScreenBox { left: number; top: number; width: number; height: number }

/** Viewport coordinates throughout; choose free space, then clamp without moving the artwork. */
export function placeLayerPanel(anchor: ScreenBox, viewport: { width: number; height: number }) {
  const margin = 12, gap = 16
  const height = Math.min(650, Math.max(0, viewport.height - margin * 2))
  const right = viewport.width - margin - (anchor.left + anchor.width) - gap
  const left = anchor.left - margin - gap
  const free = Math.max(left, right)
  const width = Math.min(free >= 360 ? free : 500, 500, Math.max(0, viewport.width - margin * 2))
  const side = right >= width ? 'right' : left >= width ? 'left' : right >= left ? 'right' : 'left'
  const x = side === 'right' ? anchor.left + anchor.width + gap : anchor.left - width - gap
  return { side, width, height,
    left: Math.max(margin, Math.min(x, viewport.width - margin - width)),
    top: Math.max(margin, Math.min(anchor.top, viewport.height - margin - height)) }
}

import type { CutPoint, CutPolygon } from '@shared/cutting-pattern'

export function signedRingArea(ring: CutPoint[]): number {
  return ring.reduce((sum, [x, y], i) => {
    const next = ring[(i + 1) % ring.length]
    return sum + x * next[1] - next[0] * y
  }, 0) / 2
}
function inside([x, y]: CutPoint, ring: CutPoint[]): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j]
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit
  }
  return hit
}

/** Trace the existing alpha mask, not colors. No smoothing, size filtering, merging or hole filling.
 * The 50% alpha isocontour defines a pixel's physical footprint. Only exactly collinear vertices
 * are removed. Disconnected islands remain independent cuts, however small or thin they are.
 */
export function psdMaskContours(rgba: Uint8ClampedArray, width: number, height: number): CutPolygon[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('PSD 图层像素尺寸不一致。')
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && rgba[(y * width + x) * 4 + 3] >= 128
  type Edge = { end: number; dir: number }
  const edges = new Map<number, Edge[]>(), stride = width + 1
  function add(x: number, y: number, endX: number, endY: number, dir: number) {
    const id = y * stride + x, list = edges.get(id) ?? []
    list.push({ end: endY * stride + endX, dir }); edges.set(id, list)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (filled(x, y)) {
    if (!filled(x, y - 1)) add(x, y, x + 1, y, 0)
    if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1)
    if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2)
    if (!filled(x - 1, y)) add(x, y + 1, x, y, 3)
  }
  const rings: { ring: CutPoint[]; area: number }[] = []
  while (edges.size) {
    const start = edges.keys().next().value!, ring: CutPoint[] = []
    let current = start, incoming: number | undefined
    do {
      const options = edges.get(current)
      if (!options?.length) throw new Error('PSD 裁剪轮廓未闭合。')
      // Keep filled material to the right. At a diagonal contact, turn right;
      // do not bridge two islands through a single shared corner.
      const order = [1, 0, 3, 2]
      const index = incoming === undefined ? 0 : options.reduce((best, edge, i) =>
        order.indexOf((edge.dir - incoming! + 4) % 4) < order.indexOf((options[best].dir - incoming! + 4) % 4) ? i : best, 0)
      const [edge] = options.splice(index, 1)
      if (!options.length) edges.delete(current)
      ring.push([current % stride, Math.floor(current / stride)])
      incoming = edge.dir; current = edge.end
    } while (current !== start)
    const exact = ring.filter((point, i) => {
      const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
      return (point[0] - prev[0]) * (next[1] - point[1]) !== (point[1] - prev[1]) * (next[0] - point[0])
    })
    const area = signedRingArea(exact)
    if (exact.length < 3 || !area) throw new Error('PSD 裁剪轮廓无效。')
    rings.push({ ring: exact, area })
  }
  const outer = rings.filter(item => item.area > 0).map(item => ({ ...item, polygon: [item.ring] }))
  for (const hole of rings.filter(item => item.area < 0)) {
    const [a, b] = hole.ring, dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    const point: CutPoint = [(a[0] + b[0]) / 2 + dy / length * .25, (a[1] + b[1]) / 2 - dx / length * .25]
    const owner = outer.filter(item => inside(point, item.ring)).sort((a, b) => a.area - b.area)[0]
    if (!owner) throw new Error('PSD 镂空轮廓缺少所属裁片。')
    owner.polygon.push(hole.ring)
  }
  return outer.map(item => item.polygon)
}

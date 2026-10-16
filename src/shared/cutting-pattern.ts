/** Printable craft templates, not a manufacturing certification. Full geometry includes hidden material. */
export type CutPoint = [number, number]
export type CutPolygon = CutPoint[][]
export interface CuttingGeometry {
  resultSha256: string
  sourceSha256: string
  width: number
  height: number
  pieces: { id: string; step: number; color: string; polygons: CutPolygon[] }[]
  /** Verified union of the algorithm's backing members, retaining real holes. */
  backing?: { pieceIds: string[]; polygons: CutPolygon[] }
}

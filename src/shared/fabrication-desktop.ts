/** Desktop integration DTO, separate from frozen fabrication contracts. */
export type ForegroundMode = 'birefnet-general' | 'embedded-alpha'
export interface FabricationStep {
  step: number
  colorSlotId: string
  rgb: number[]
  pieceIds: string[]
  pieceNumbers: number[]
  asset: string
}
export interface FabricationView {
  schemaVersion: 'desktop-fabrication-view/1'
  resultSha256: string
  sourceSha256: string
  width: number
  height: number
  pieceCount: number
  steps: FabricationStep[]
  stepCount: number
  materialDepth: number
  assets: Record<string, string>
  geometryStatus: string
  visualAcceptance: 'PENDING'
  manufacturing: 'NOT_EVALUATED'
  productionExportEligible: false
}
export interface FabricationJob {
  id: string
  /** Main-process authenticated owner; legacy unowned jobs are not auto-claimed. */
  ownerUserId?: string
  status: 'queued' | 'background' | 'fabrication' | 'complete' | 'failed' | 'timeout'
  binding?: import('./fabrication-colors').SceneBinding | null
  mode?: ForegroundMode
  message: string
  startedAt: number
  result?: FabricationView
}
export const FABRICATION_CHANNELS = {
  list: 'fabrication:list', retry: 'fabrication:retry', availability: 'fabrication:availability',
  start: 'fabrication:start', status: 'fabrication:status', asset: 'fabrication:asset',
  colors: 'fabrication:colors', saveColors: 'fabrication:save-colors', resume: 'fabrication:resume'
} as const

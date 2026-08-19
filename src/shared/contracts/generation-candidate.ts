import type { PersonalAssetRole } from './personal-asset'
import type { ResourceRef, UtcIso8601, Uuid } from './common'

export const GENERATION_CANDIDATE_STATUSES = [
  'GENERATED_TEMP',
  'QUALITY_CHECKED',
  'REVIEWABLE',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED'
] as const
export type GenerationCandidateStatus = (typeof GENERATION_CANDIDATE_STATUSES)[number]

export const GENERATION_QUALITY_VERDICTS = ['PASS', 'WARN', 'FAIL'] as const
export type GenerationQualityVerdict = (typeof GENERATION_QUALITY_VERDICTS)[number]

export interface GenerationQualityReport {
  verdict: GenerationQualityVerdict
  messages: string[]
  metrics?: {
    width?: number
    height?: number
    uniqueColors?: number
    opaqueRatio?: number
    edgeComplexity?: number
  }
}

/**
 * Temporary generation result. Not a PersonalAsset and must not be written
 * into SceneDocument until the user accepts it.
 */
export interface GenerationCandidate {
  candidateId: Uuid
  generationRequestId: string
  assetRole: PersonalAssetRole
  status: GenerationCandidateStatus
  temporaryRef: ResourceRef
  width: number
  height: number
  createdAt: UtcIso8601
  quality?: GenerationQualityReport
}

export interface ProviderPromptPayload {
  positiveText: string
  negativeText: string
  width: number
  height: number
}

export function generationSizeForRole(role: PersonalAssetRole): { width: number; height: number } {
  if (role === 'background') return { width: 1024, height: 768 }
  return { width: 512, height: 512 }
}

export function candidateStatusForQuality(
  quality: GenerationQualityReport | undefined
): GenerationCandidateStatus {
  if (!quality) return 'REVIEWABLE'
  if (quality.verdict === 'FAIL') return 'QUALITY_CHECKED'
  return 'REVIEWABLE'
}

/** Core-pattern works may proceed even when quality is FAIL; messages stay advisory. */
export function canAcceptCandidate(candidate: GenerationCandidate | null | undefined): boolean {
  if (!candidate) return false
  if (candidate.status === 'ACCEPTED' || candidate.status === 'REJECTED' || candidate.status === 'EXPIRED') {
    return false
  }
  return Boolean(candidate.temporaryRef)
}

import { describe, expect, it } from 'vitest'
import { assertFlatInputSafe, lockedEvaluationReviews, reviewIsCurrent, validateDataset, validateMappings, validateReviewRecords } from '@shared/contracts/review-validation'
import type { EndpointMapping, ReviewBinding, ReviewRecord } from '@shared/contracts/review'

const bindingFor = (targetId: string): ReviewBinding => ({ targetId, targetVersion: '1', targetSha256: 'a'.repeat(64), recipeIdentity: 'recipe-1', endpointIdentity: 'endpoints-1' })
const relationBinding = bindingFor('relation-1')
const approvedRelation: ReviewRecord = {
  schemaVersion: 'b2.review/1', reviewId: 'relation-review', domain: 'reviewed_fabrication_truth', binding: relationBinding, reviewType: 'RELATION', reviewerRole: 'PROJECT_FABRICATION_REVIEWER', question: 'relation?', options: ['NO_RELATION', 'UNRESOLVED'], answer: 'NO_RELATION', evidenceArtifactIds: ['e'], note: null, state: 'APPROVED', signoff: 'SIGNED_OFF', recordedAt: '2026-09-19T00:00:00.000Z',
}
const mapping = (mappingId: string, approvalReviewId: string | null): EndpointMapping => ({ mappingId, semanticLabel: 'flap', sourceRegionRef: null, componentRefs: [], observedCandidateRefs: [], fabricationPieceRefs: [], evidenceArtifactIds: ['e'], state: approvalReviewId ? 'APPROVED' : 'PROPOSED', approvalReviewId })
const approvedMappingReview = (mappingId: string): ReviewRecord => ({ ...approvedRelation, reviewId: `mapping-review-${mappingId}`, binding: bindingFor(mappingId), reviewType: 'MAPPING', question: 'mapping?', options: ['APPROVE', 'REJECT'], answer: 'APPROVE' })

describe('M2 review contract', () => {
  it('fails closed for forged locked records', () => {
    const bindings = new Map([['relation-1', relationBinding]])
    for (const review of [{ ...approvedRelation, reviewerRole: 'PRODUCTION_USER_DECISION' as const }, { ...approvedRelation, answer: null }, { ...approvedRelation, answer: 'BAD' }, { ...approvedRelation, evidenceArtifactIds: [] }]) expect(lockedEvaluationReviews([review], bindings)).toHaveLength(0)
  })

  it('requires every approved review to meet the locked-review contract', () => {
    const bindings = new Map([['relation-1', relationBinding]])
    expect(validateReviewRecords([approvedRelation], new Set(['relation-1']), bindings).ok).toBe(true)
    expect(validateReviewRecords([{ ...approvedRelation, answer: 'BAD' }], new Set(['relation-1']), bindings).ok).toBe(false)
    expect(validateReviewRecords([{ ...approvedRelation, evidenceArtifactIds: [] }], new Set(['relation-1']), bindings).ok).toBe(false)
    expect(validateReviewRecords([{ ...approvedRelation, binding: { ...relationBinding, targetVersion: 'stale' } }], new Set(['relation-1']), bindings).ok).toBe(false)
    expect(validateReviewRecords([approvedRelation], new Set(['relation-1'])).ok).toBe(false)
  })

  it('binds mapping approval to that mapping’s own current MAPPING review', () => {
    const bindingA = bindingFor('map-a')
    const bindingB = bindingFor('map-b')
    const bindings = new Map([['map-a', bindingA], ['map-b', bindingB]])
    const mappingAReview = approvedMappingReview('map-a')
    const mappingBReview = approvedMappingReview('map-b')
    expect(validateMappings([mapping('map-a', approvedRelation.reviewId)], new Set(['e']), [approvedRelation], new Map([['relation-1', relationBinding], ['map-a', bindingA]])).ok).toBe(false)
    expect(validateMappings([mapping('map-b', mappingAReview.reviewId)], new Set(['e']), [mappingAReview], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-a', mappingAReview.reviewId)], new Set(['e']), [{ ...mappingAReview, binding: { ...bindingA, targetVersion: 'stale' } }], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-a', mappingAReview.reviewId)], new Set(['e']), [mappingAReview, mappingBReview], bindings).ok).toBe(true)
  })

  it('rejects duplicate or dangling records and mappings', () => {
    expect(validateReviewRecords([approvedRelation, { ...approvedRelation }], new Set(['relation-1']), new Map([['relation-1', relationBinding]])).ok).toBe(false)
    expect(validateMappings([{ ...mapping('m', null), evidenceArtifactIds: ['missing'] }], new Set()).ok).toBe(false)
    expect(validateMappings([mapping('a', null)], new Set(['e'])).ok).toBe(true)
    expect(reviewIsCurrent(approvedRelation, relationBinding)).toBe(true)
  })

  it('requires complete denylist and rejects nested leakage', () => {
    expect(validateDataset([{ itemId: 'a', sourceLineageId: 'src', split: 'development', runtimeInputs: ['png'], forbiddenFlatBenchmarkFields: ['reviewAnswers'] }]).ok).toBe(false)
    expect(assertFlatInputSafe({ safe: { reviewedGT: 'bad' } }).ok).toBe(false)
    expect(assertFlatInputSafe({ source: 'x' }).ok).toBe(true)
  })
})

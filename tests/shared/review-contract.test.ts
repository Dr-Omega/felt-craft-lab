import { describe, expect, it } from 'vitest'
import { assertFlatInputSafe, lockedEvaluationReviews, reviewIsCurrent, validateDataset, validateMappings, validateReviewRecords } from '@shared/contracts/review-validation'
import type { DatasetItem, EndpointMapping, ReviewBinding, ReviewRecord } from '@shared/contracts/review'

const evidence = new Set(['e'])
const bindingFor = (targetId: string): ReviewBinding => ({ targetId, targetVersion: '1', targetSha256: 'a'.repeat(64), recipeIdentity: 'recipe-1', endpointIdentity: 'endpoints-1' })
const relationBinding = bindingFor('relation-1')
const approvedRelation: ReviewRecord = {
  schemaVersion: 'b2.review/1', reviewId: 'relation-review', domain: 'reviewed_fabrication_truth', binding: relationBinding, reviewType: 'RELATION', reviewerRole: 'PROJECT_FABRICATION_REVIEWER', question: 'relation?', options: ['NO_RELATION', 'UNRESOLVED'], answer: 'NO_RELATION', evidenceArtifactIds: ['e'], note: null, state: 'APPROVED', signoff: 'SIGNED_OFF', recordedAt: '2026-09-19T00:00:00.000Z',
}
const mapping = (mappingId: string, approvalReviewId: string | null, endpoint = true): EndpointMapping => ({ mappingId, semanticLabel: 'flap', sourceRegionRef: endpoint ? 'region-1' : null, componentRefs: [], observedCandidateRefs: [], fabricationPieceRefs: [], evidenceArtifactIds: ['e'], state: approvalReviewId ? 'APPROVED' : 'PROPOSED', approvalReviewId })
const approvedMappingReview = (mappingId: string): ReviewRecord => ({ ...approvedRelation, reviewId: 'mapping-review-' + mappingId, binding: bindingFor(mappingId), reviewType: 'MAPPING', question: 'mapping?', options: ['APPROVE', 'REJECT'], answer: 'APPROVE' })
const datasetItem = (itemId: string, lineage = 'source-1', split: DatasetItem['split'] = 'development'): DatasetItem => ({ itemId, sourceLineageId: lineage, split, runtimeInputs: ['image/png'], forbiddenFlatBenchmarkFields: ['psdLayerName', 'psdZOrder', 'reviewAnswers', 'reviewedGT', 'semanticCategoryHint', 'fabricationAnnotation'] })

describe('M2 review contract', () => {
  it('fails closed for forged locked records and missing evidence context', () => {
    const bindings = new Map([['relation-1', relationBinding]])
    for (const review of [{ ...approvedRelation, reviewerRole: 'PRODUCTION_USER_DECISION' as const }, { ...approvedRelation, answer: null }, { ...approvedRelation, answer: 'BAD' }, { ...approvedRelation, evidenceArtifactIds: [] }, { ...approvedRelation, evidenceArtifactIds: ['missing'] }]) {
      expect(lockedEvaluationReviews([review], bindings, 'RELATION', evidence)).toHaveLength(0)
    }
    expect(validateReviewRecords([approvedRelation], new Set(['relation-1']), bindings).ok).toBe(false)
    expect(validateReviewRecords([approvedRelation], new Set(['relation-1']), bindings, evidence).ok).toBe(true)
  })

  it('requires approved review answer, evidence, and every current binding field', () => {
    const bindings = new Map([['relation-1', relationBinding]])
    expect(validateReviewRecords([{ ...approvedRelation, answer: 'BAD' }], new Set(['relation-1']), bindings, evidence).ok).toBe(false)
    expect(validateReviewRecords([{ ...approvedRelation, evidenceArtifactIds: [] }], new Set(['relation-1']), bindings, evidence).ok).toBe(false)
    expect(validateReviewRecords([{ ...approvedRelation, evidenceArtifactIds: ['missing'] }], new Set(['relation-1']), bindings, evidence).ok).toBe(false)
    for (const field of ['targetVersion', 'targetSha256', 'recipeIdentity', 'endpointIdentity'] as const) {
      expect(validateReviewRecords([{ ...approvedRelation, binding: { ...relationBinding, [field]: 'stale' } }], new Set(['relation-1']), bindings, evidence).ok).toBe(false)
    }
  })

  it('binds mapping approval to its own current MAPPING APPROVE review', () => {
    const bindingA = bindingFor('map-a')
    const bindingB = bindingFor('map-b')
    const bindings = new Map([['map-a', bindingA], ['map-b', bindingB], ['relation-1', relationBinding]])
    const mappingAReview = approvedMappingReview('map-a')
    const mappingBReview = approvedMappingReview('map-b')
    expect(validateMappings([mapping('map-a', approvedRelation.reviewId)], evidence, [approvedRelation], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-b', mappingAReview.reviewId)], evidence, [mappingAReview], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-a', mappingAReview.reviewId)], evidence, [{ ...mappingAReview, binding: { ...bindingA, targetVersion: 'stale' } }], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-a', mappingAReview.reviewId)], evidence, [{ ...mappingAReview, answer: 'REJECT' }], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-a', mappingAReview.reviewId)], evidence, [mappingAReview, mappingBReview], bindings).ok).toBe(true)
  })

  it('blocks empty approved mappings but permits valid endpoints and keeps proposed mappings flexible', () => {
    const binding = bindingFor('map-a')
    const review = approvedMappingReview('map-a')
    const bindings = new Map([['map-a', binding]])
    expect(validateMappings([mapping('map-a', review.reviewId, false)], evidence, [review], bindings).ok).toBe(false)
    expect(validateMappings([mapping('map-a', review.reviewId)], evidence, [review], bindings).ok).toBe(true)
    expect(validateMappings([mapping('proposal', null, false)], evidence).ok).toBe(true)
    expect(validateMappings([{ ...mapping('bad', null), componentRefs: ['component', 'component'] }], evidence).ok).toBe(false)
    expect(validateMappings([{ ...mapping('bad', null), observedCandidateRefs: [''] }], evidence).ok).toBe(false)
  })

  it('rejects duplicate or dangling records and mappings', () => {
    expect(validateReviewRecords([approvedRelation, { ...approvedRelation }], new Set(['relation-1']), new Map([['relation-1', relationBinding]]), evidence).ok).toBe(false)
    expect(validateMappings([{ ...mapping('m', null), evidenceArtifactIds: ['missing'] }], evidence).ok).toBe(false)
    expect(reviewIsCurrent(approvedRelation, relationBinding)).toBe(true)
  })

  it('runtime-validates every dataset field and split isolation', () => {
    expect(validateDataset([datasetItem('a'), datasetItem('a', 'source-2')]).ok).toBe(false)
    expect(validateDataset([{ ...datasetItem('a'), itemId: '' }]).ok).toBe(false)
    expect(validateDataset([{ ...datasetItem('a'), sourceLineageId: '' }]).ok).toBe(false)
    expect(validateDataset([{ ...datasetItem('a'), split: 'invalid' }]).ok).toBe(false)
    expect(validateDataset([{ ...datasetItem('a'), runtimeInputs: [''] }]).ok).toBe(false)
    expect(validateDataset([{ ...datasetItem('a'), forbiddenFlatBenchmarkFields: 'bad' }]).ok).toBe(false)
    expect(validateDataset([datasetItem('a', 'shared', 'development'), datasetItem('b', 'shared', 'holdout')]).ok).toBe(false)
    expect(validateDataset([datasetItem('a', 'shared'), datasetItem('b', 'shared')]).ok).toBe(true)
    expect(validateDataset([datasetItem('a'), datasetItem('b', 'source-2', 'calibration'), datasetItem('c', 'source-3', 'holdout')]).ok).toBe(true)
  })

  it('requires the complete denylist and recurses through nested arrays', () => {
    expect(validateDataset([{ ...datasetItem('a'), forbiddenFlatBenchmarkFields: ['reviewAnswers'] }]).ok).toBe(false)
    expect(assertFlatInputSafe({ items: [{ safe: { reviewedGT: 'bad' } }] }).ok).toBe(false)
    expect(assertFlatInputSafe({ source: 'x', items: [{ safe: true }] }).ok).toBe(true)
  })

  it('rejects malformed raw array elements without throwing', () => {
    for (const malformed of [null, 1, 'bad', []]) {
      expect(() => validateReviewRecords([malformed], new Set(), new Map(), evidence)).not.toThrow()
      expect(validateReviewRecords([malformed], new Set(), new Map(), evidence).ok).toBe(false)
      expect(() => validateMappings([malformed], evidence)).not.toThrow()
      expect(validateMappings([malformed], evidence).ok).toBe(false)
      expect(() => validateDataset([malformed])).not.toThrow()
      expect(validateDataset([malformed]).ok).toBe(false)
    }
  })

  it('runtime-validates review and mapping enums plus required fields', () => {
    const bindings = new Map([['relation-1', relationBinding]])
    for (const invalid of [
      { schemaVersion: 'bad' },
      { domain: 'bad' },
      { reviewType: 'WHATEVER' },
      { reviewerRole: 'bad' },
      { state: 'bad' },
      { signoff: 'bad' },
      { question: '' },
      { options: ['NO_RELATION', 'NO_RELATION'] },
      { answer: '' },
      { evidenceArtifactIds: [''] },
      { recordedAt: '' },
      { binding: [] },
    ]) {
      expect(validateReviewRecords([{ ...approvedRelation, ...invalid }], new Set(['relation-1']), bindings, evidence).ok).toBe(false)
    }
    expect(validateMappings([{ ...mapping('bad-state', null), state: 'UNKNOWN' }], evidence).ok).toBe(false)
    expect(validateMappings([{ ...mapping('bad-approval', null), approvalReviewId: '' }], evidence).ok).toBe(false)
  })
})

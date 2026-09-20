import type { ValidationIssue, ValidationResult } from './validation'
import type { DatasetItem, EndpointMapping, ReviewBinding, ReviewRecord } from './review'

const bad = <T>(errors: ValidationIssue[]): ValidationResult<T> => ({ ok: false, errors })
const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value })
const error = (errors: ValidationIssue[], path: string, message: string): void => { errors.push({ path, message }) }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const deny = ['psdLayerName', 'psdZOrder', 'reviewAnswers', 'reviewedGT', 'semanticCategoryHint', 'fabricationAnnotation'] as const
const allowedSplits = new Set(['development', 'calibration', 'holdout'])

export function reviewIsCurrent(review: ReviewRecord, binding: ReviewBinding): boolean {
  return review.binding.targetId === binding.targetId
    && review.binding.targetVersion === binding.targetVersion
    && review.binding.targetSha256 === binding.targetSha256
    && review.binding.recipeIdentity === binding.recipeIdentity
    && review.binding.endpointIdentity === binding.endpointIdentity
}

function hasKnownEvidence(review: Partial<ReviewRecord>, knownEvidence?: ReadonlySet<string>): boolean {
  return !!knownEvidence
    && Array.isArray(review.evidenceArtifactIds)
    && review.evidenceArtifactIds.length > 0
    && review.evidenceArtifactIds.every(id => text(id) && knownEvidence.has(id))
}

function isSignedFabricationReview(
  review: Partial<ReviewRecord>,
  expectedReviewType: ReviewRecord['reviewType'],
  knownEvidence?: ReadonlySet<string>,
  currentBinding?: ReviewBinding,
): boolean {
  return review.domain === 'reviewed_fabrication_truth'
    && review.reviewType === expectedReviewType
    && review.state === 'APPROVED'
    && review.signoff === 'SIGNED_OFF'
    && review.reviewerRole === 'PROJECT_FABRICATION_REVIEWER'
    && text(review.answer)
    && Array.isArray(review.options)
    && review.options.includes(review.answer)
    && hasKnownEvidence(review, knownEvidence)
    && !!review.binding
    && text(review.binding.targetId)
    && text(review.binding.targetVersion)
    && text(review.binding.targetSha256)
    && text(review.binding.recipeIdentity)
    && text(review.binding.endpointIdentity)
    && (!currentBinding || reviewIsCurrent(review as ReviewRecord, currentBinding))
}

/** Approved records fail closed without a current binding and known evidence. */
export function validateReviewRecords(
  raw: unknown,
  knownTargets: ReadonlySet<string>,
  bindings?: ReadonlyMap<string, ReviewBinding>,
  knownEvidence?: ReadonlySet<string>,
): ValidationResult<ReviewRecord[]> {
  const errors: ValidationIssue[] = []
  if (!Array.isArray(raw)) return bad([{ path: '$', message: 'Expected array' }])
  const ids = new Set<string>()
  for (const [index, record] of raw.entries()) {
    const review = record as Partial<ReviewRecord>
    const path = '$[' + index + ']'
    if (!text(review.reviewId) || ids.has(review.reviewId ?? '')) error(errors, path + '.reviewId', 'Missing or duplicate review ID')
    ids.add(review.reviewId ?? '')
    if (review.domain === 'algorithm_prediction' && review.signoff === 'SIGNED_OFF') error(errors, path + '.signoff', 'Algorithm proposal cannot sign off GT')
    if (!review.binding || !knownTargets.has(review.binding.targetId) || !text(review.binding.targetSha256) || !text(review.binding.targetVersion) || !text(review.binding.recipeIdentity) || !text(review.binding.endpointIdentity)) {
      error(errors, path + '.binding', 'Dangling or incomplete target binding')
    }
    if (review.state === 'APPROVED') {
      const currentBinding = review.binding ? bindings?.get(review.binding.targetId) : undefined
      if (!review.reviewType || !isSignedFabricationReview(review, review.reviewType, knownEvidence, currentBinding)) {
        error(errors, path, 'Approved review requires a current signed typed fabrication review, legal answer, and known evidence')
      }
      if (!bindings || !currentBinding) error(errors, path + '.binding', 'Approved review target has no current binding')
      if (!knownEvidence) error(errors, path + '.evidenceArtifactIds', 'Approved review has no known evidence context')
    }
  }
  return errors.length ? bad(errors) : ok(raw as ReviewRecord[])
}

/** Type-scoped locked review gate: cross-type approval reuse is impossible. */
export function lockedEvaluationReviews(
  reviews: ReviewRecord[],
  bindings: ReadonlyMap<string, ReviewBinding>,
  expectedReviewType: ReviewRecord['reviewType'],
  knownEvidence: ReadonlySet<string>,
): ReviewRecord[] {
  return reviews.filter(review => {
    const binding = bindings.get(review.binding.targetId)
    return !!binding && isSignedFabricationReview(review, expectedReviewType, knownEvidence, binding)
  })
}

const endpointArrays = ['componentRefs', 'observedCandidateRefs', 'fabricationPieceRefs'] as const

function validateEndpointMappingEndpoints(mapping: Partial<EndpointMapping>, index: number, errors: ValidationIssue[]): boolean {
  let endpointCount = 0
  const path = '$[' + index + ']'
  if (mapping.sourceRegionRef !== null && mapping.sourceRegionRef !== undefined) {
    if (!text(mapping.sourceRegionRef)) error(errors, path + '.sourceRegionRef', 'sourceRegionRef must be null or a non-empty string')
    else endpointCount++
  }
  for (const field of endpointArrays) {
    const values = mapping[field]
    if (!Array.isArray(values)) {
      error(errors, path + '.' + field, 'Endpoint references must be an array')
      continue
    }
    const seen = new Set<string>()
    values.forEach((value, itemIndex) => {
      if (!text(value)) error(errors, path + '.' + field + '[' + itemIndex + ']', 'Endpoint reference must be a non-empty string')
      else if (seen.has(value)) error(errors, path + '.' + field + '[' + itemIndex + ']', 'Duplicate endpoint reference')
      else {
        seen.add(value)
        endpointCount++
      }
    })
  }
  return endpointCount > 0
}

export function validateMappings(
  raw: unknown,
  knownEvidence: ReadonlySet<string>,
  reviews: ReviewRecord[] = [],
  bindings: ReadonlyMap<string, ReviewBinding> = new Map(),
): ValidationResult<EndpointMapping[]> {
  const errors: ValidationIssue[] = []
  if (!Array.isArray(raw)) return bad([{ path: '$', message: 'Expected array' }])
  const ids = new Set<string>()
  const lockedMappingReviews = lockedEvaluationReviews(reviews, bindings, 'MAPPING', knownEvidence)
  raw.forEach((item, index) => {
    const mapping = item as Partial<EndpointMapping>
    const path = '$[' + index + ']'
    if (!text(mapping.mappingId) || ids.has(mapping.mappingId ?? '')) error(errors, path + '.mappingId', 'Missing or duplicate mapping ID')
    ids.add(mapping.mappingId ?? '')
    if (!text(mapping.semanticLabel) || !Array.isArray(mapping.evidenceArtifactIds) || mapping.evidenceArtifactIds.length === 0) {
      error(errors, path, 'Mapping needs semantic label and evidence')
    } else {
      const evidenceIds = new Set<string>()
      mapping.evidenceArtifactIds.forEach((id, evidenceIndex) => {
        if (!text(id) || evidenceIds.has(id) || !knownEvidence.has(id)) error(errors, path + '.evidenceArtifactIds[' + evidenceIndex + ']', 'Dangling, empty, or duplicate evidence')
        evidenceIds.add(id)
      })
    }
    const hasEndpoint = validateEndpointMappingEndpoints(mapping, index, errors)
    if (mapping.state === 'APPROVED') {
      if (!hasEndpoint) error(errors, path, 'Approved mapping requires at least one endpoint reference')
      const approval = mapping.approvalReviewId ? lockedMappingReviews.find(review => review.reviewId === mapping.approvalReviewId) : undefined
      if (!approval || approval.answer !== 'APPROVE' || approval.binding.targetId !== mapping.mappingId) {
        error(errors, path + '.approvalReviewId', 'Approved mapping requires its own current signed MAPPING APPROVE review')
      }
    }
  })
  return errors.length ? bad(errors) : ok(raw as EndpointMapping[])
}

export function validateDataset(raw: unknown): ValidationResult<DatasetItem[]> {
  const errors: ValidationIssue[] = []
  if (!Array.isArray(raw)) return bad([{ path: '$', message: 'Expected array' }])
  const itemIds = new Set<string>()
  const splitByLineage = new Map<string, string>()
  raw.forEach((entry, index) => {
    const item = entry as Partial<DatasetItem>
    const path = '$[' + index + ']'
    if (!text(item.itemId) || itemIds.has(item.itemId ?? '')) error(errors, path + '.itemId', 'itemId must be non-empty and unique')
    itemIds.add(item.itemId ?? '')
    if (!text(item.sourceLineageId)) error(errors, path + '.sourceLineageId', 'sourceLineageId must be non-empty')
    if (!allowedSplits.has(item.split ?? '')) error(errors, path + '.split', 'split must be development, calibration, or holdout')
    if (!Array.isArray(item.runtimeInputs) || item.runtimeInputs.some(value => !text(value))) error(errors, path + '.runtimeInputs', 'runtimeInputs must be an array of non-empty strings')
    const denylist = item.forbiddenFlatBenchmarkFields
    if (!Array.isArray(denylist) || denylist.some(value => !text(value))) {
      error(errors, path + '.forbiddenFlatBenchmarkFields', 'forbiddenFlatBenchmarkFields must be an array of non-empty strings')
    } else if (deny.some(field => !denylist.includes(field))) {
      error(errors, path + '.forbiddenFlatBenchmarkFields', 'Mandatory denylist incomplete')
    }
    if (text(item.sourceLineageId) && allowedSplits.has(item.split ?? '')) {
      const existingSplit = splitByLineage.get(item.sourceLineageId)
      if (existingSplit && existingSplit !== item.split) error(errors, path + '.split', 'Source lineage leaks across splits')
      splitByLineage.set(item.sourceLineageId, item.split as string)
    }
  })
  return errors.length ? bad(errors) : ok(raw as DatasetItem[])
}

export function assertFlatInputSafe(input: Record<string, unknown>): ValidationResult<Record<string, unknown>> {
  const errors: ValidationIssue[] = []
  const seen = new WeakSet<object>()
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (deny.includes(key as typeof deny[number])) errors.push({ path: path + '.' + key, message: 'Forbidden GT leakage field' })
      walk(nested, path + '.' + key)
    })
  }
  walk(input, '$')
  return errors.length ? bad(errors) : ok(input)
}

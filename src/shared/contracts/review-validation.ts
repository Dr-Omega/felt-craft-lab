import type { ValidationIssue, ValidationResult } from './validation'
import type { DatasetItem, EndpointMapping, ReviewBinding, ReviewRecord } from './review'

const bad = <T>(errors: ValidationIssue[]): ValidationResult<T> => ({ ok: false, errors })
const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value })
const error = (errors: ValidationIssue[], path: string, message: string): void => { errors.push({ path, message }) }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const sha256Text = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const objectRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const deny = ['psdLayerName', 'psdZOrder', 'reviewAnswers', 'reviewedGT', 'semanticCategoryHint', 'fabricationAnnotation'] as const
const allowedSplits = new Set(['development', 'calibration', 'holdout'])
const reviewDomains = new Set(['raw_authoring_truth', 'reviewed_fabrication_truth', 'algorithm_prediction'])
const reviewTypes = new Set(['RELATION', 'MAPPING', 'COLOR', 'SKIN', 'LAYERED', 'BASE', 'SPLIT', 'MANUFACTURING'])
const reviewerRoles = new Set(['PROJECT_FABRICATION_REVIEWER', 'PRODUCTION_USER_DECISION', 'ALGORITHM_PROPOSAL'])
const reviewStates = new Set(['DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED', 'STALE'])
const signoffs = new Set(['NOT_SIGNED', 'SIGNED_OFF'])
const mappingStates = new Set(['PROPOSED', 'REVIEWED', 'APPROVED', 'REJECTED'])

const strings = (value: unknown, requireUnique = false): value is string[] => Array.isArray(value)
  && value.every(text)
  && (!requireUnique || new Set(value).size === value.length)

function bindingIsValid(binding: unknown): binding is ReviewBinding {
  return objectRecord(binding)
    && text(binding.targetId)
    && text(binding.targetVersion)
    && sha256Text(binding.targetSha256)
    && text(binding.recipeIdentity)
    && text(binding.endpointIdentity)
}

function reviewShapeIsValid(review: unknown): review is ReviewRecord {
  if (!objectRecord(review)) return false
  return review.schemaVersion === 'b2.review/1'
    && text(review.reviewId)
    && typeof review.domain === 'string' && reviewDomains.has(review.domain)
    && bindingIsValid(review.binding)
    && typeof review.reviewType === 'string' && reviewTypes.has(review.reviewType)
    && typeof review.reviewerRole === 'string' && reviewerRoles.has(review.reviewerRole)
    && text(review.question)
    && strings(review.options, true) && review.options.length > 0
    && (review.answer === null || text(review.answer))
    && strings(review.evidenceArtifactIds, true) && review.evidenceArtifactIds.length > 0
    && (review.note === null || typeof review.note === 'string')
    && typeof review.state === 'string' && reviewStates.has(review.state)
    && typeof review.signoff === 'string' && signoffs.has(review.signoff)
    && text(review.recordedAt)
}

function addReviewShapeErrors(review: unknown, path: string, errors: ValidationIssue[]): review is ReviewRecord {
  if (!objectRecord(review)) {
    error(errors, path, 'Review record must be a non-null object, not an array')
    return false
  }
  if (review.schemaVersion !== 'b2.review/1') error(errors, path + '.schemaVersion', 'schemaVersion must be b2.review/1')
  if (!text(review.reviewId)) error(errors, path + '.reviewId', 'reviewId must be a non-empty string')
  if (typeof review.domain !== 'string' || !reviewDomains.has(review.domain)) error(errors, path + '.domain', 'Invalid review domain')
  if (!objectRecord(review.binding)) {
    error(errors, path + '.binding', 'Binding must be a non-null object, not an array')
  } else {
    if (!text(review.binding.targetId)) error(errors, path + '.binding.targetId', 'targetId must be a non-empty string')
    if (!text(review.binding.targetVersion)) error(errors, path + '.binding.targetVersion', 'targetVersion must be a non-empty string')
    if (!sha256Text(review.binding.targetSha256)) error(errors, path + '.binding.targetSha256', 'targetSha256 must be a lowercase SHA-256 hex digest')
    if (!text(review.binding.recipeIdentity)) error(errors, path + '.binding.recipeIdentity', 'recipeIdentity must be a non-empty string')
    if (!text(review.binding.endpointIdentity)) error(errors, path + '.binding.endpointIdentity', 'endpointIdentity must be a non-empty string')
  }
  if (typeof review.reviewType !== 'string' || !reviewTypes.has(review.reviewType)) error(errors, path + '.reviewType', 'Invalid review type')
  if (typeof review.reviewerRole !== 'string' || !reviewerRoles.has(review.reviewerRole)) error(errors, path + '.reviewerRole', 'Invalid reviewer role')
  if (!text(review.question)) error(errors, path + '.question', 'question must be a non-empty string')
  if (!strings(review.options, true) || review.options.length === 0) error(errors, path + '.options', 'options must be unique non-empty strings')
  if (review.answer !== null && !text(review.answer)) error(errors, path + '.answer', 'answer must be null or a non-empty string')
  if (!strings(review.evidenceArtifactIds, true) || review.evidenceArtifactIds.length === 0) error(errors, path + '.evidenceArtifactIds', 'evidenceArtifactIds must be unique non-empty strings')
  if (review.note !== null && typeof review.note !== 'string') error(errors, path + '.note', 'note must be null or a string')
  if (typeof review.state !== 'string' || !reviewStates.has(review.state)) error(errors, path + '.state', 'Invalid review state')
  if (typeof review.signoff !== 'string' || !signoffs.has(review.signoff)) error(errors, path + '.signoff', 'Invalid signoff')
  if (!text(review.recordedAt)) error(errors, path + '.recordedAt', 'recordedAt must be a non-empty string')
  return reviewShapeIsValid(review)
}

export function reviewIsCurrent(review: ReviewRecord, binding: ReviewBinding): boolean {
  return review.binding.targetId === binding.targetId
    && review.binding.targetVersion === binding.targetVersion
    && review.binding.targetSha256 === binding.targetSha256
    && review.binding.recipeIdentity === binding.recipeIdentity
    && review.binding.endpointIdentity === binding.endpointIdentity
}

function hasKnownEvidence(review: ReviewRecord, knownEvidence?: ReadonlySet<string>): boolean {
  return !!knownEvidence
    && review.evidenceArtifactIds.length > 0
    && review.evidenceArtifactIds.every(id => knownEvidence.has(id))
}

function isSignedFabricationReview(
  review: unknown,
  expectedReviewType: ReviewRecord['reviewType'],
  knownEvidence?: ReadonlySet<string>,
  currentBinding?: ReviewBinding,
): boolean {
  if (!reviewShapeIsValid(review) || !reviewTypes.has(expectedReviewType)) return false
  return review.domain === 'reviewed_fabrication_truth'
    && review.reviewType === expectedReviewType
    && review.state === 'APPROVED'
    && review.signoff === 'SIGNED_OFF'
    && review.reviewerRole === 'PROJECT_FABRICATION_REVIEWER'
    && review.answer !== null
    && review.options.includes(review.answer)
    && hasKnownEvidence(review, knownEvidence)
    && (!currentBinding || reviewIsCurrent(review, currentBinding))
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
  raw.forEach((record, index) => {
    const path = '$[' + index + ']'
    if (!addReviewShapeErrors(record, path, errors)) return
    if (ids.has(record.reviewId)) error(errors, path + '.reviewId', 'Duplicate review ID')
    ids.add(record.reviewId)
    if (record.domain === 'algorithm_prediction' && record.signoff === 'SIGNED_OFF') error(errors, path + '.signoff', 'Algorithm proposal cannot sign off GT')
    if (!knownTargets.has(record.binding.targetId)) error(errors, path + '.binding.targetId', 'Dangling target binding')
    if (record.state === 'APPROVED') {
      const currentBinding = bindings?.get(record.binding.targetId)
      if (!isSignedFabricationReview(record, record.reviewType, knownEvidence, currentBinding)) {
        error(errors, path, 'Approved review requires a current signed allowed fabrication review, legal answer, and known evidence')
      }
      if (!bindings || !currentBinding) error(errors, path + '.binding', 'Approved review target has no current binding')
      if (!knownEvidence) error(errors, path + '.evidenceArtifactIds', 'Approved review has no known evidence context')
    }
  })
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
    if (!reviewShapeIsValid(review)) return false
    const binding = bindings.get(review.binding.targetId)
    return !!binding && isSignedFabricationReview(review, expectedReviewType, knownEvidence, binding)
  })
}

const endpointArrays = ['componentRefs', 'observedCandidateRefs', 'fabricationPieceRefs'] as const

function validateEndpointMappingEndpoints(mapping: Record<string, unknown>, index: number, errors: ValidationIssue[]): boolean {
  let endpointCount = 0
  const path = '$[' + index + ']'
  if (mapping.sourceRegionRef !== null && mapping.sourceRegionRef !== undefined) {
    if (!text(mapping.sourceRegionRef)) error(errors, path + '.sourceRegionRef', 'sourceRegionRef must be null or a non-empty string')
    else endpointCount++
  }
  for (const field of endpointArrays) {
    const values = mapping[field]
    if (!strings(values, true)) {
      error(errors, path + '.' + field, 'Endpoint references must be unique non-empty strings')
      continue
    }
    endpointCount += values.length
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
    const path = '$[' + index + ']'
    if (!objectRecord(item)) {
      error(errors, path, 'EndpointMapping must be a non-null object, not an array')
      return
    }
    if (!text(item.mappingId) || ids.has(item.mappingId)) error(errors, path + '.mappingId', 'Missing or duplicate mapping ID')
    if (text(item.mappingId)) ids.add(item.mappingId)
    if (!text(item.semanticLabel)) error(errors, path + '.semanticLabel', 'Mapping needs semantic label')
    if (!strings(item.evidenceArtifactIds, true) || item.evidenceArtifactIds.length === 0) {
      error(errors, path + '.evidenceArtifactIds', 'Mapping needs unique non-empty evidence IDs')
    } else {
      item.evidenceArtifactIds.forEach((id, evidenceIndex) => {
        if (!knownEvidence.has(id)) error(errors, path + '.evidenceArtifactIds[' + evidenceIndex + ']', 'Dangling evidence')
      })
    }
    if (typeof item.state !== 'string' || !mappingStates.has(item.state)) error(errors, path + '.state', 'Invalid mapping state')
    if (item.approvalReviewId !== null && !text(item.approvalReviewId)) error(errors, path + '.approvalReviewId', 'approvalReviewId must be null or a non-empty string')
    if (item.sourceRegionRef !== null && !text(item.sourceRegionRef)) error(errors, path + '.sourceRegionRef', 'sourceRegionRef must be null or a non-empty string')
    const hasEndpoint = validateEndpointMappingEndpoints(item, index, errors)
    if (item.state === 'APPROVED') {
      if (!hasEndpoint) error(errors, path, 'Approved mapping requires at least one endpoint reference')
      const approval = text(item.approvalReviewId) ? lockedMappingReviews.find(review => review.reviewId === item.approvalReviewId) : undefined
      if (!approval || approval.answer !== 'APPROVE' || approval.binding.targetId !== item.mappingId) {
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
    const path = '$[' + index + ']'
    if (!objectRecord(entry)) {
      error(errors, path, 'Dataset item must be a non-null object, not an array')
      return
    }
    if (!text(entry.itemId) || itemIds.has(entry.itemId)) error(errors, path + '.itemId', 'itemId must be non-empty and unique')
    if (text(entry.itemId)) itemIds.add(entry.itemId)
    if (!text(entry.sourceLineageId)) error(errors, path + '.sourceLineageId', 'sourceLineageId must be non-empty')
    if (typeof entry.split !== 'string' || !allowedSplits.has(entry.split)) error(errors, path + '.split', 'split must be development, calibration, or holdout')
    if (!strings(entry.runtimeInputs)) error(errors, path + '.runtimeInputs', 'runtimeInputs must be an array of non-empty strings')
    const denylist = entry.forbiddenFlatBenchmarkFields
    if (!strings(denylist, true)) {
      error(errors, path + '.forbiddenFlatBenchmarkFields', 'forbiddenFlatBenchmarkFields must be unique non-empty strings')
    } else if (deny.some(field => !denylist.includes(field))) {
      error(errors, path + '.forbiddenFlatBenchmarkFields', 'Mandatory denylist incomplete')
    }
    if (text(entry.sourceLineageId) && typeof entry.split === 'string' && allowedSplits.has(entry.split)) {
      const existingSplit = splitByLineage.get(entry.sourceLineageId)
      if (existingSplit && existingSplit !== entry.split) error(errors, path + '.split', 'Source lineage leaks across splits')
      splitByLineage.set(entry.sourceLineageId, entry.split)
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

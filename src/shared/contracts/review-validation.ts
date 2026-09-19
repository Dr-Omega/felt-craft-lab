import type { ValidationIssue, ValidationResult } from './validation'
import type { DatasetItem, EndpointMapping, ReviewBinding, ReviewRecord } from './review'

const bad = <T>(errors: ValidationIssue[]): ValidationResult<T> => ({ ok: false, errors })
const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value })
const error = (errors: ValidationIssue[], path: string, message: string): void => { errors.push({ path, message }) }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function reviewIsCurrent(review: ReviewRecord, binding: ReviewBinding): boolean {
  return review.binding.targetId === binding.targetId && review.binding.targetVersion === binding.targetVersion && review.binding.targetSha256 === binding.targetSha256 && review.binding.recipeIdentity === binding.recipeIdentity && review.binding.endpointIdentity === binding.endpointIdentity
}

/** Minimum fail-closed conditions shared by validation and the locked-evaluation gate. */
function isSignedFabricationReview(review: Partial<ReviewRecord>, currentBinding?: ReviewBinding): boolean {
  return review.domain === 'reviewed_fabrication_truth' && review.state === 'APPROVED' && review.signoff === 'SIGNED_OFF' && review.reviewerRole === 'PROJECT_FABRICATION_REVIEWER' && text(review.answer) && Array.isArray(review.options) && review.options.includes(review.answer) && Array.isArray(review.evidenceArtifactIds) && review.evidenceArtifactIds.length > 0 && !!review.binding && text(review.binding.targetId) && text(review.binding.targetVersion) && text(review.binding.targetSha256) && text(review.binding.recipeIdentity) && text(review.binding.endpointIdentity) && (!currentBinding || reviewIsCurrent(review as ReviewRecord, currentBinding))
}

export function validateReviewRecords(raw: unknown, knownTargets: ReadonlySet<string>, bindings?: ReadonlyMap<string, ReviewBinding>): ValidationResult<ReviewRecord[]> {
  const errors: ValidationIssue[] = []
  if (!Array.isArray(raw)) return bad([{ path: '$', message: 'Expected array' }])
  const ids = new Set<string>()
  for (const [index, record] of raw.entries()) {
    const review = record as Partial<ReviewRecord>
    if (!text(review.reviewId) || ids.has(review.reviewId ?? '')) error(errors, `$[${index}].reviewId`, 'Missing or duplicate review ID')
    ids.add(review.reviewId ?? '')
    if (review.domain === 'algorithm_prediction' && review.signoff === 'SIGNED_OFF') error(errors, `$[${index}].signoff`, 'Algorithm proposal cannot sign off GT')
    if (!review.binding || !knownTargets.has(review.binding.targetId) || !text(review.binding.targetSha256) || !text(review.binding.targetVersion) || !text(review.binding.recipeIdentity) || !text(review.binding.endpointIdentity)) error(errors, `$[${index}].binding`, 'Dangling or incomplete target binding')
    if (review.state === 'APPROVED') {
      const currentBinding = review.binding ? bindings?.get(review.binding.targetId) : undefined
      if (!isSignedFabricationReview(review, currentBinding)) error(errors, `$[${index}]`, 'Approved review requires a current signed fabrication review, legal answer, and evidence')
      if (!bindings || !currentBinding) error(errors, `$[${index}].binding`, 'Approved review target has no current binding')
    }
  }
  return errors.length ? bad(errors) : ok(raw as ReviewRecord[])
}

export function lockedEvaluationReviews(reviews: ReviewRecord[], bindings: ReadonlyMap<string, ReviewBinding>): ReviewRecord[] {
  return reviews.filter(review => {
    const binding = bindings.get(review.binding.targetId)
    return !!binding && isSignedFabricationReview(review, binding)
  })
}

export function validateMappings(mappings: EndpointMapping[], knownEvidence: ReadonlySet<string>, reviews: ReviewRecord[] = [], bindings: ReadonlyMap<string, ReviewBinding> = new Map()): ValidationResult<EndpointMapping[]> {
  const errors: ValidationIssue[] = []
  const ids = new Set<string>()
  const locked = lockedEvaluationReviews(reviews, bindings)
  mappings.forEach((mapping, index) => {
    if (!text(mapping.mappingId) || ids.has(mapping.mappingId)) error(errors, `$[${index}].mappingId`, 'Missing or duplicate mapping ID')
    ids.add(mapping.mappingId)
    if (!text(mapping.semanticLabel) || !mapping.evidenceArtifactIds.length) error(errors, `$[${index}]`, 'Mapping needs semantic label and evidence')
    mapping.evidenceArtifactIds.forEach(id => { if (!knownEvidence.has(id)) error(errors, `$[${index}].evidenceArtifactIds`, 'Dangling evidence') })
    if (mapping.state === 'APPROVED') {
      const approval = mapping.approvalReviewId ? locked.find(review => review.reviewId === mapping.approvalReviewId) : undefined
      if (!approval || approval.reviewType !== 'MAPPING' || approval.binding.targetId !== mapping.mappingId) error(errors, `$[${index}].approvalReviewId`, 'Approved mapping requires its own current signed MAPPING review')
    }
  })
  return errors.length ? bad(errors) : ok(mappings)
}

const deny = ['psdLayerName', 'psdZOrder', 'reviewAnswers', 'reviewedGT', 'semanticCategoryHint', 'fabricationAnnotation']
export function validateDataset(items: DatasetItem[]): ValidationResult<DatasetItem[]> {
  const errors: ValidationIssue[] = []
  const splitByLineage = new Map<string, string>()
  items.forEach((item, index) => {
    if (splitByLineage.has(item.sourceLineageId) && splitByLineage.get(item.sourceLineageId) !== item.split) error(errors, `$[${index}].split`, 'Source lineage leaks across splits')
    splitByLineage.set(item.sourceLineageId, item.split)
    if (deny.some(field => !item.forbiddenFlatBenchmarkFields.includes(field))) error(errors, `$[${index}].forbiddenFlatBenchmarkFields`, 'Mandatory denylist incomplete')
  })
  return errors.length ? bad(errors) : ok(items)
}

export function assertFlatInputSafe(input: Record<string, unknown>): ValidationResult<Record<string, unknown>> {
  const errors: ValidationIssue[] = []
  const walk = (value: unknown, path: string): void => {
    if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (deny.includes(key)) errors.push({ path: `${path}.${key}`, message: 'Forbidden GT leakage field' })
      walk(nested, `${path}.${key}`)
    })
  }
  walk(input, '$')
  return errors.length ? bad(errors) : ok(input)
}

import type { ValidationIssue, ValidationResult } from './validation'
import { inputShape, manufacturingShape, resultShape, shapeErrors, structureShape } from './fabrication-shape'
import type { ArtifactIdentity, FabricationInput, FabricationResult, ManufacturingAssessment, ObservedCandidate, StructuralAssessment } from './fabrication'

const fail = <T>(errors: ValidationIssue[]): ValidationResult<T> => ({ ok: false, errors })
const pass = <T>(value: T): ValidationResult<T> => ({ ok: true, value })
const add = (errors: ValidationIssue[], path: string, message: string): void => { errors.push({ path, message }) }
const at = (base: string, index: number): string => base + '[' + index + ']'
const unique = (values: readonly string[], path: string, errors: ValidationIssue[]): Set<string> => {
  const seen = new Set<string>()
  values.forEach((value, index) => { if (seen.has(value)) add(errors, at(path, index), 'Duplicate ID: ' + value); seen.add(value) })
  return seen
}
const requireAll = (ids: readonly string[], allowed: ReadonlySet<string>, path: string, errors: ValidationIssue[]): void => ids.forEach((id, index) => {
  if (!allowed.has(id)) add(errors, at(path, index), 'Dangling reference: ' + id)
})
const det = (m: readonly number[]): number => m[0] * m[3] - m[1] * m[2]
const gatePass = (gate: { status: string; evidenceArtifactIds: string[] }): boolean => gate.status === 'PASS' && gate.evidenceArtifactIds.length > 0
const allPass = (checks: Record<string, { status: string; evidenceArtifactIds: string[] }>): boolean => Object.values(checks).every(gatePass)

/** Standards-based BigInt SHA-256 used synchronously by the shared validator. */
const sha256Exact = (text: string): string => {
  const mask = 0xffffffffn
  const constants = [0x428a2f98n,0x71374491n,0xb5c0fbcfn,0xe9b5dba5n,0x3956c25bn,0x59f111f1n,0x923f82a4n,0xab1c5ed5n,0xd807aa98n,0x12835b01n,0x243185ben,0x550c7dc3n,0x72be5d74n,0x80deb1fen,0x9bdc06a7n,0xc19bf174n,0xe49b69c1n,0xefbe4786n,0x0fc19dc6n,0x240ca1ccn,0x2de92c6fn,0x4a7484aan,0x5cb0a9dcn,0x76f988dan,0x983e5152n,0xa831c66dn,0xb00327c8n,0xbf597fc7n,0xc6e00bf3n,0xd5a79147n,0x06ca6351n,0x14292967n,0x27b70a85n,0x2e1b2138n,0x4d2c6dfcn,0x53380d13n,0x650a7354n,0x766a0abbn,0x81c2c92en,0x92722c85n,0xa2bfe8a1n,0xa81a664bn,0xc24b8b70n,0xc76c51a3n,0xd192e819n,0xd6990624n,0xf40e3585n,0x106aa070n,0x19a4c116n,0x1e376c08n,0x2748774cn,0x34b0bcb5n,0x391c0cb3n,0x4ed8aa4an,0x5b9cca4fn,0x682e6ff3n,0x748f82een,0x78a5636fn,0x84c87814n,0x8cc70208n,0x90befffan,0xa4506cebn,0xbef9a3f7n,0xc67178f2n]
  const bytes = new TextEncoder().encode(text)
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes); padded[bytes.length] = 0x80
  const bitLength = BigInt(bytes.length) * 8n
  for (let index = 0; index < 8; index++) padded[padded.length - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn)
  const rotateRight = (value: bigint, bits: number): bigint => ((value >> BigInt(bits)) | (value << BigInt(32 - bits))) & mask
  let h0=0x6a09e667n,h1=0xbb67ae85n,h2=0x3c6ef372n,h3=0xa54ff53an,h4=0x510e527fn,h5=0x9b05688cn,h6=0x1f83d9abn,h7=0x5be0cd19n
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Array<bigint>(64).fill(0n)
    for (let index = 0; index < 16; index++) words[index] = (BigInt(padded[offset + index * 4]) << 24n) | (BigInt(padded[offset + index * 4 + 1]) << 16n) | (BigInt(padded[offset + index * 4 + 2]) << 8n) | BigInt(padded[offset + index * 4 + 3])
    for (let index = 16; index < 64; index++) {
      const a=words[index-15],b=words[index-2]
      words[index]=((rotateRight(a,7)^rotateRight(a,18)^(a>>3n))+words[index-16]+(rotateRight(b,17)^rotateRight(b,19)^(b>>10n))+words[index-7])&mask
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7
    for (let index = 0; index < 64; index++) {
      const next1=(h+(rotateRight(e,6)^rotateRight(e,11)^rotateRight(e,25))+((e&f)^((~e)&g))+constants[index]+words[index])&mask
      const next2=((rotateRight(a,2)^rotateRight(a,13)^rotateRight(a,22))+((a&b)^(a&c)^(b&c)))&mask
      h=g;g=f;f=e;e=(d+next1)&mask;d=c;c=b;b=a;a=(next1+next2)&mask
    }
    h0=(h0+a)&mask;h1=(h1+b)&mask;h2=(h2+c)&mask;h3=(h3+d)&mask;h4=(h4+e)&mask;h5=(h5+f)&mask;h6=(h6+g)&mask;h7=(h7+h)&mask
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(value=>value.toString(16).padStart(8,'0')).join('')
}

export function canonicalPayloadJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map(key => [key, normalize((v as Record<string, unknown>)[key])]))
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Canonical payload cannot contain non-finite number')
    return v
  }
  return JSON.stringify(normalize(value)) + '\n'
}

export function canonicalTextLfUtf8(text: string): string { return text.replace(/\r\n?/g, '\n') }

export async function canonicalPayloadSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPayloadJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Validate real fabrication input independently of any candidate pieces. */
export function validateFabricationInput(raw: unknown): ValidationResult<FabricationInput> {
  const errors = shapeErrors(inputShape, raw)
  if (errors.length) return fail(errors)
  validateInputRules(raw as FabricationInput, errors)
  return errors.length ? fail(errors) : pass(raw as FabricationInput)
}

const validateInputRules = (input: FabricationInput, errors: ValidationIssue[]): void => {
  const artifactIds = unique(input.artifacts.map(artifact => artifact.id), '$.artifacts', errors)
  const frameIds = unique(input.coordinates.frames.map(frame => frame.id), '$.coordinates.frames', errors)
  unique(input.coordinates.transforms.map(transform => transform.id), '$.coordinates.transforms', errors)
  const requiredFrames: Array<[string, string, string]> = [
    ['sourceFrameId', input.coordinates.sourceFrameId, 'source-native'],
    ['analysisFrameId', input.coordinates.analysisFrameId, 'analysis-raster'],
    ['p004cFrameId', input.coordinates.p004cFrameId, 'p0-04c'],
    ['canonicalFrameId', input.coordinates.canonicalFrameId, 'fabrication-canonical'],
  ]
  requiredFrames.forEach(([role, id, space]) => { if (!input.coordinates.frames.some(frame => frame.id === id && frame.space === space)) add(errors, '$.coordinates.' + role, 'Must identify a ' + space + ' frame') })
  requireAll([input.source.artifactId, input.frozenRegionArtifactId, input.frozenVectorArtifactId], artifactIds, '$', errors)
  if (input.source.normalizedLayerEvidenceId) requireAll([input.source.normalizedLayerEvidenceId], artifactIds, '$.source.normalizedLayerEvidenceId', errors)
  input.coordinates.frames.forEach((frame, index) => requireAll([frame.sourceArtifactId], artifactIds, at('$.coordinates.frames', index) + '.sourceArtifactId', errors))
  input.coordinates.transforms.forEach((transform, index) => {
    const path = at('$.coordinates.transforms', index)
    requireAll([transform.fromFrameId, transform.toFrameId], frameIds, path, errors)
    requireAll(transform.evidenceArtifactIds, artifactIds, path + '.evidenceArtifactIds', errors)
    if (det(transform.matrix) === 0) add(errors, path + '.matrix', 'Transform is not invertible')
  })
  const reachable = (from: string, to: string): boolean => {
    const seen = new Set([from]), todo = [from]
    while (todo.length) {
      const current = todo.shift()!
      for (const transform of input.coordinates.transforms.filter(item => item.fromFrameId === current)) {
        if (transform.toFrameId === to) return true
        if (!seen.has(transform.toFrameId)) { seen.add(transform.toFrameId); todo.push(transform.toFrameId) }
      }
    }
    return false
  }
  if (!reachable(input.coordinates.sourceFrameId, input.coordinates.analysisFrameId) || !reachable(input.coordinates.analysisFrameId, input.coordinates.p004cFrameId) || !reachable(input.coordinates.p004cFrameId, input.coordinates.canonicalFrameId)) add(errors, '$.coordinates.transforms', 'Missing required source→analysis→p0-04c→canonical lineage')
  const checkGeometry = (geometry: { artifactId: string; frameId: string }, path: string): void => { requireAll([geometry.artifactId], artifactIds, path + '.artifactId', errors); requireAll([geometry.frameId], frameIds, path + '.frameId', errors) }
  const colorIds = unique(input.colorSlots.map(slot => slot.id), '$.colorSlots', errors)
  input.colorSlots.forEach((slot, index) => requireAll([slot.purificationArtifactId], artifactIds, at('$.colorSlots', index) + '.purificationArtifactId', errors))
  unique(input.observedRegions.map(region => region.id), '$.observedRegions', errors)
  input.observedRegions.forEach((region, index) => { requireAll([region.colorSlotId], colorIds, at('$.observedRegions', index) + '.colorSlotId', errors); checkGeometry(region.geometry, at('$.observedRegions', index) + '.geometry') })
  input.colorSlots.forEach((slot, index) => { if (slot.rgb.some(channel => channel > 255)) add(errors, at('$.colorSlots', index) + '.rgb', 'RGB channels must be within 0..255') })
  unique(input.observedRegions.flatMap(region => region.componentIds), '$.observedRegions.componentIds', errors)
}

export function validateFabricationResult(raw: unknown, expectedSha256?: string): ValidationResult<FabricationResult> {
  const errors = shapeErrors(resultShape, raw)
  if (errors.length) return fail(errors)
  const result = raw as FabricationResult
  if (result.identity.sha256 !== sha256Exact(canonicalPayloadJson(result.payload))) add(errors, '$.identity.sha256', 'Canonical identity does not match payload')
  if (expectedSha256 && result.identity.sha256 !== expectedSha256) add(errors, '$.identity.sha256', 'Does not match supplied canonical identity')
  const { input, pieces, splitGroups, relations } = result.payload
  const inputValidation = validateFabricationInput(input)
  if (!inputValidation.ok) inputValidation.errors.forEach(issue => add(errors, '$.payload.input' + issue.path.slice(1), issue.message))
  const artifactIds = new Set(input.artifacts.map(artifact => artifact.id))
  const frameIds = new Set(input.coordinates.frames.map(frame => frame.id))
  const colorIds = new Set(input.colorSlots.map(slot => slot.id))
  const regionIds = new Set(input.observedRegions.map(region => region.id))
  const checkGeometry = (geometry: { artifactId: string; frameId: string }, path: string): void => { requireAll([geometry.artifactId], artifactIds, path + '.artifactId', errors); requireAll([geometry.frameId], frameIds, path + '.frameId', errors) }
  const pieceIds = unique(pieces.map(piece => piece.id), '$.payload.pieces', errors)
  pieces.forEach((piece, index) => { requireAll([piece.colorSlotId], colorIds, at('$.payload.pieces', index) + '.colorSlotId', errors); requireAll(piece.sourceRegionIds, regionIds, at('$.payload.pieces', index) + '.sourceRegionIds', errors); checkGeometry(piece.geometry, at('$.payload.pieces', index) + '.geometry') })
  result.payload.baseExposures.forEach((exposure, index) => {
    const path = at('$.payload.baseExposures', index)
    requireAll([exposure.sourceRegionId], regionIds, path + '.sourceRegionId', errors)
    requireAll([exposure.basePieceId], pieceIds, path + '.basePieceId', errors)
    if (pieces.find(piece => piece.id === exposure.basePieceId)?.role !== 'BASE') add(errors, path + '.basePieceId', 'Must reference BASE piece')
    checkGeometry(exposure.geometry, path + '.geometry')
  })
  const groupIds = unique(splitGroups.map(group => group.id), '$.payload.splitGroups', errors)
  const seamIds = new Set<string>(), pieceGroups = new Map<string, string[]>()
  splitGroups.forEach((group, index) => {
    const path = at('$.payload.splitGroups', index)
    unique(group.pieceIds, path + '.pieceIds', errors)
    requireAll(group.sourceRegionIds, regionIds, path + '.sourceRegionIds', errors)
    requireAll(group.pieceIds, pieceIds, path + '.pieceIds', errors)
    requireAll(group.partitionEvidenceIds, artifactIds, path + '.partitionEvidenceIds', errors)
    group.pieceIds.forEach(pieceId => pieceGroups.set(pieceId, [...(pieceGroups.get(pieceId) ?? []), group.id]))
    const members = pieces.filter(piece => group.pieceIds.includes(piece.id))
    group.sourceRegionIds.forEach(regionId => { if (!members.some(piece => piece.sourceRegionIds.includes(regionId))) add(errors, path + '.sourceRegionIds', 'Split-group source region is not used by any member piece') })
    members.forEach(piece => { if (!piece.sourceRegionIds.some(regionId => group.sourceRegionIds.includes(regionId))) add(errors, path + '.pieceIds', 'Split-group member has no source region shared with its group') })
    group.seams.forEach((seam, seamIndex) => {
      const seamPath = path + '.seams[' + seamIndex + ']'
      if (seamIds.has(seam.id)) add(errors, seamPath + '.id', 'Duplicate seam ID')
      seamIds.add(seam.id)
      requireAll([...seam.pieceIds], pieceIds, seamPath + '.pieceIds', errors)
      if (!group.pieceIds.includes(seam.pieceIds[0]) || !group.pieceIds.includes(seam.pieceIds[1]) || seam.pieceIds[0] === seam.pieceIds[1]) add(errors, seamPath + '.pieceIds', 'Seam must join two distinct pieces in its split group')
      checkGeometry(seam.geometry, seamPath + '.geometry')
      requireAll([seam.measurementEvidenceId], artifactIds, seamPath + '.measurementEvidenceId', errors)
    })
  })
  pieces.forEach((piece, index) => {
    const memberships = pieceGroups.get(piece.id) ?? []
    const path = at('$.payload.pieces', index) + '.splitGroupId'
    if (memberships.length > 1) add(errors, path, 'Piece cannot belong to multiple split groups')
    if (piece.splitGroupId) {
      requireAll([piece.splitGroupId], groupIds, path, errors)
      if (!splitGroups.find(group => group.id === piece.splitGroupId)?.pieceIds.includes(piece.id)) add(errors, path, 'Split group does not include piece')
    }
    if (memberships.length === 1 && piece.splitGroupId !== memberships[0]) add(errors, path, 'Piece membership must bind back to its split group')
  })
  const relationIds = unique(relations.map(relation => relation.id), '$.payload.relations', errors), assembly = new Map<string, string[]>()
  relations.forEach((relation, index) => {
    const path = at('$.payload.relations', index)
    if (relation.status === 'RESOLVED' ? !relation.direction : relation.direction !== null) add(errors, path + '.direction', 'Direction must exist exactly for RESOLVED relation')
    if ((relation.status === 'RESOLVED' || relation.status === 'NO_RELATION') && relation.evidenceArtifactIds.length === 0) add(errors, path + '.evidenceArtifactIds', 'Resolved decisions require evidence')
    requireAll(relation.evidenceArtifactIds, artifactIds, path + '.evidenceArtifactIds', errors)
    const endpoints = relation.kind === 'VISUAL_OCCLUSION_RELATION' ? regionIds : pieceIds
    requireAll([relation.a, relation.b], endpoints, path, errors)
    if (relation.a === relation.b) add(errors, path, 'Relation endpoints must differ')
    if (relation.kind === 'ASSEMBLY_PRECEDENCE' && relation.status === 'RESOLVED') {
      const from = relation.direction === 'A_TO_B' ? relation.a : relation.b
      const to = relation.direction === 'A_TO_B' ? relation.b : relation.a
      assembly.set(from, [...(assembly.get(from) ?? []), to])
    }
  })
  const visiting = new Set<string>(), visited = new Set<string>()
  const cycle = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const found = (assembly.get(id) ?? []).some(cycle); visiting.delete(id); visited.add(id); return found }
  if ([...pieceIds].some(cycle)) add(errors, '$.payload.relations', 'Assembly precedence graph contains a cycle')
  const coverageKinds = ['VISUAL_OCCLUSION_RELATION', 'ASSEMBLY_PRECEDENCE'] as const
  const coverageKindIds = unique(result.payload.relationCoverage.map(coverage => coverage.kind), '$.payload.relationCoverage', errors)
  coverageKinds.forEach(kind => {
    if (!coverageKindIds.has(kind)) add(errors, '$.payload.relationCoverage', 'Missing coverage for relation kind: ' + kind)
  })
  result.payload.relationCoverage.forEach((coverage, index) => {
    const path = at('$.payload.relationCoverage', index)
    if (coverage.status === 'COMPLETE') {
      if (coverage.evidenceArtifactIds.length === 0) add(errors, path + '.evidenceArtifactIds', 'COMPLETE coverage requires evidence')
    }
    requireAll(coverage.evidenceArtifactIds, artifactIds, path + '.evidenceArtifactIds', errors)
  })
  if (!relationIds.size && result.payload.relationCoverage.some(coverage => coverage.status === 'COMPLETE')) add(errors, '$.payload.relationCoverage', 'COMPLETE coverage needs recorded evidence/relations')
  return errors.length ? fail(errors) : pass(result)
}

const blockingRelationStatuses = (result: FabricationResult): Array<'UNRESOLVED' | 'NOT_EVALUATED'> => result.payload.relations
  .filter(relation => relation.fabricationImpact === 'BLOCKING' && (relation.status === 'UNRESOLVED' || relation.status === 'NOT_EVALUATED'))
  .map(relation => relation.status as 'UNRESOLVED' | 'NOT_EVALUATED')

export function validateStructuralAssessment(raw: unknown, result: FabricationResult): ValidationResult<StructuralAssessment> {
  const errors = shapeErrors(structureShape, raw)
  if (errors.length) return fail(errors)
  const assessment = raw as StructuralAssessment
  if (assessment.resultSha256 !== result.identity.sha256) add(errors, '$.resultSha256', 'Assessment does not bind this canonical result')
  const artifactIds = [...result.payload.input.artifacts.map(artifact => artifact.id), ...assessment.evidenceArtifacts.map(artifact => artifact.id)]
  const evidence = unique(artifactIds, '$.evidenceArtifacts', errors)
  Object.entries(assessment.checks).forEach(([key, gate]) => { requireAll(gate.evidenceArtifactIds, evidence, '$.checks.' + key + '.evidenceArtifactIds', errors); if (gate.status === 'PASS' && !gatePass(gate)) add(errors, '$.checks.' + key, 'PASS requires evidence') })
  if (blockingRelationStatuses(result).length && assessment.status === 'PASS') add(errors, '$.status', 'Blocking unresolved or not-evaluated relation prevents structural PASS')
  if (result.payload.input.source.adapter.status === 'UNSUPPORTED' && assessment.status === 'PASS') add(errors, '$.status', 'Unsupported source adapter prevents structural PASS')
  if (assessment.status === 'PASS' && !allPass(assessment.checks)) add(errors, '$.status', 'Structural PASS requires every check PASS')
  return errors.length ? fail(errors) : pass(assessment)
}

export function validateManufacturingAssessment(raw: unknown, result: FabricationResult): ValidationResult<ManufacturingAssessment> {
  const errors = shapeErrors(manufacturingShape, raw)
  if (errors.length) return fail(errors)
  const assessment = raw as ManufacturingAssessment
  if (assessment.resultSha256 !== result.identity.sha256) add(errors, '$.resultSha256', 'Assessment does not bind this canonical result')
  const artifacts: ArtifactIdentity[] = [...result.payload.input.artifacts, ...assessment.evidenceArtifacts]
  const evidence = unique(artifacts.map(artifact => artifact.id), '$.evidenceArtifacts', errors)
  requireAll([assessment.calibrationArtifactId], evidence, '$.calibrationArtifactId', errors)
  const calibration = artifacts.filter(artifact => artifact.id === assessment.calibrationArtifactId)
  if (calibration.length !== 1 || calibration[0].sha256 !== assessment.target.calibrationSha256) add(errors, '$.calibrationArtifactId', 'Calibration artifact identity must match target calibrationSha256')
  requireAll(assessment.physicalTransform.evidenceArtifactIds, evidence, '$.physicalTransform.evidenceArtifactIds', errors)
  if (assessment.review) requireAll([assessment.review.recordArtifactId], evidence, '$.review.recordArtifactId', errors)
  requireAll([assessment.physicalFrame.sourceArtifactId], evidence, '$.physicalFrame.sourceArtifactId', errors)
  if (assessment.physicalTransform.fromFrameId !== result.payload.input.coordinates.canonicalFrameId) add(errors, '$.physicalTransform.fromFrameId', 'Must originate at canonical frame')
  if (assessment.physicalTransform.toFrameId !== assessment.physicalFrame.id) add(errors, '$.physicalTransform.toFrameId', 'Must target physical-mm frame')
  if (det(assessment.physicalTransform.matrix) === 0) add(errors, '$.physicalTransform.matrix', 'Transform is not invertible')
  const [x, y, width, height] = assessment.physicalFrame.bounds
  if (x !== 0 || y !== 0 || width !== assessment.target.widthMm || height !== assessment.target.heightMm) add(errors, '$.physicalFrame.bounds', 'Must match target dimensions at top-left origin')
  const matrix = assessment.physicalTransform.matrix
  if (matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] !== matrix[3] || matrix[0] <= 0) add(errors, '$.physicalTransform.matrix', 'PRESERVE requires positive uniform axis-aligned scale')
  const canonical = result.payload.input.coordinates.frames.find(frame => frame.id === result.payload.input.coordinates.canonicalFrameId)!
  if (matrix[0] * canonical.bounds[2] !== assessment.target.widthMm || matrix[3] * canonical.bounds[3] !== assessment.target.heightMm || matrix[0] * canonical.bounds[0] + matrix[4] !== 0 || matrix[3] * canonical.bounds[1] + matrix[5] !== 0) add(errors, '$.physicalTransform.matrix', 'Must map canonical bounds exactly to current physical target')
  const seams = result.payload.splitGroups.flatMap(group => group.seams)
  if (assessment.seamMetrics.count !== seams.length) add(errors, '$.seamMetrics.count', 'Must equal canonical AddedSeam count')
  if (assessment.seamMetrics.seams.length !== seams.length) add(errors, '$.seamMetrics.seams', 'Must contain exactly the canonical AddedSeam count')
  const metricIds = unique(assessment.seamMetrics.seams.map(seam => seam.seamId), '$.seamMetrics.seams', errors)
  requireAll(seams.map(seam => seam.id), metricIds, '$.seamMetrics.seams', errors)
  requireAll([...metricIds], new Set(seams.map(seam => seam.id)), '$.seamMetrics.seams', errors)
  const seamById = new Map(seams.map(seam => [seam.id, seam]))
  let total = 0
  assessment.seamMetrics.seams.forEach((seam, index) => {
    const path = '$.seamMetrics.seams[' + index + ']'
    total += seam.lengthMm
    const canonicalSeam = seamById.get(seam.seamId)
    if (canonicalSeam && Math.abs(seam.lengthMm - canonicalSeam.lengthCanonical * matrix[0]) > 1e-9) add(errors, path + '.lengthMm', 'Must be derived from canonical seam and physical transform')
    requireAll(seam.acceptance.evidenceArtifactIds, evidence, path + '.acceptance.evidenceArtifactIds', errors)
    if (seam.acceptance.status === 'PASS' && !gatePass(seam.acceptance)) add(errors, path + '.acceptance', 'PASS requires evidence')
  })
  if (assessment.status === 'PASS' && assessment.seamMetrics.seams.some(seam => seam.acceptance.status !== 'PASS')) add(errors, '$.status', 'Manufacturing PASS requires every seam acceptance PASS')
  if (Math.abs(total - assessment.seamMetrics.totalLengthMm) > 1e-9) add(errors, '$.seamMetrics.totalLengthMm', 'Must equal recorded seam lengths')
  Object.entries(assessment.checks).forEach(([key, gate]) => { requireAll(gate.evidenceArtifactIds, evidence, '$.checks.' + key + '.evidenceArtifactIds', errors); if (gate.status === 'PASS' && !gatePass(gate)) add(errors, '$.checks.' + key, 'PASS requires evidence') })
  if (assessment.status === 'PASS' && (!allPass(assessment.checks) || (seams.length > 0 && !assessment.review))) add(errors, '$.status', 'Manufacturing PASS requires passing checks and split review')
  return errors.length ? fail(errors) : pass(assessment)
}

export function exportEligibility(result: FabricationResult, structural: StructuralAssessment, assessments: ManufacturingAssessment[], target: ManufacturingAssessment['target']): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!validateFabricationResult(result).ok) reasons.push('CANONICAL_RESULT_INVALID')
  if (!validateStructuralAssessment(structural, result).ok || structural.status !== 'PASS') reasons.push('STRUCTURAL_ASSESSMENT_NOT_PASS')
  const current = assessments.filter(assessment => assessment.resultSha256 === result.identity.sha256 && assessment.target.widthMm === target.widthMm && assessment.target.heightMm === target.heightMm && assessment.target.profileId === target.profileId && assessment.target.profileVersion === target.profileVersion && assessment.target.calibrationSha256 === target.calibrationSha256)
  if (!current.some(assessment => validateManufacturingAssessment(assessment, result).ok && assessment.status === 'PASS')) reasons.push('CURRENT_MANUFACTURING_ASSESSMENT_NOT_PASS')
  const blocking = blockingRelationStatuses(result)
  if (blocking.includes('UNRESOLVED')) reasons.push('BLOCKING_RELATION_UNRESOLVED')
  if (blocking.includes('NOT_EVALUATED')) reasons.push('BLOCKING_RELATION_NOT_EVALUATED')
  return { eligible: reasons.length === 0, reasons }
}

/** Read-only legacy consumer: no V0 mutation, inference, or FLD fixture construction. */
export function adaptB2V0ObservedOnly(input: FabricationInput, legacy: { pieces: readonly { sourceRegionIds?: unknown; sourceComponentIds?: unknown; observedGeometry?: unknown; representativeColor?: unknown }[] }, geometryFor: (legacyPiece: unknown, index: number) => { artifactId: string; objectId: string; frameId: string }, colorSlotFor: (legacyPiece: unknown, index: number) => string): ObservedCandidate {
  return { schemaVersion: 'b2.observed-candidate/1', input, status: 'NOT_EVALUATED', unspecifiedRelation: 'NOT_EVALUATED', regions: legacy.pieces.map((piece, index) => ({ id: 'legacy-observed-' + (index + 1), componentIds: Array.isArray(piece.sourceComponentIds) ? piece.sourceComponentIds.filter((value): value is string => typeof value === 'string') : [], colorSlotId: colorSlotFor(piece, index), geometry: geometryFor(piece, index) })) }
}

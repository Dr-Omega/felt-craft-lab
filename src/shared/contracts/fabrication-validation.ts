import type { ValidationIssue, ValidationResult } from './validation'
import { manufacturingShape, resultShape, shapeErrors, structureShape } from './fabrication-shape'
import type { FabricationInput, FabricationResult, ManufacturingAssessment, ObservedCandidate, StructuralAssessment } from './fabrication'

const fail = <T>(errors: ValidationIssue[]): ValidationResult<T> => ({ ok: false, errors })
const pass = <T>(value: T): ValidationResult<T> => ({ ok: true, value })
const add = (errors: ValidationIssue[], path: string, message: string): void => { errors.push({ path, message }) }
const unique = (values: readonly string[], path: string, errors: ValidationIssue[]): Set<string> => {
  const seen = new Set<string>(); values.forEach((v, i) => { if (seen.has(v)) add(errors, `${path}[${i}]`, `Duplicate ID: ${v}`); seen.add(v) }); return seen
}
const requireAll = (ids: readonly string[], allowed: Set<string>, path: string, errors: ValidationIssue[]): void => ids.forEach((id, i) => { if (!allowed.has(id)) add(errors, `${path}[${i}]`, `Dangling reference: ${id}`) })
const det = (m: readonly number[]): number => m[0] * m[3] - m[1] * m[2]
const gatePass = (gate: { status: string; evidenceArtifactIds: string[] }): boolean => gate.status === 'PASS' && gate.evidenceArtifactIds.length > 0
const allPass = (checks: Record<string, { status: string; evidenceArtifactIds: string[] }>): boolean => Object.values(checks).every(gatePass)
/** Small synchronous SHA-256 for shared/renderer validation; no Node runtime dependency. */
const sha256 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  const constants = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2])
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes); padded[bytes.length] = 0x80
  const bitLength = bytes.length * 8, finalView = new DataView(padded.buffer)
  finalView.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000))
  finalView.setUint32(padded.length - 4, bitLength >>> 0)
  const rotateRight = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits))
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64), view = new DataView(padded.buffer, offset, 64)
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(index * 4)
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15], b = words[index - 2]
      words[index] = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) + words[index - 16] + (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) + words[index - 7]
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let index = 0; index < 64; index++) {
      const next1 = (h + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) + ((e & f) ^ (~e & g)) + constants[index] + words[index]) >>> 0
      const next2 = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + next1) >>> 0; d = c; c = b; b = a; a = (next1 + next2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(value => value.toString(16).padStart(8, '0')).join('')
}

/** Stable, recursively sorted JSON plus exactly one LF. Caller's SHA-256 is the identity hash. */
export function canonicalPayloadJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map(k => [k, normalize((v as Record<string, unknown>)[k])]))
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Canonical payload cannot contain non-finite number')
    return v
  }
  return `${JSON.stringify(normalize(value))}\n`
}

/** TEXT_LF_UTF8 artifact identity normalization; binary artifacts remain exact bytes. */
export function canonicalTextLfUtf8(text: string): string { return text.replace(/\r\n?/g, '\n') }

/** Browser/Electron-safe identity producer; callers persist this result in CanonicalIdentity.sha256. */
export async function canonicalPayloadSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPayloadJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function validateFabricationResult(raw: unknown, expectedSha256?: string): ValidationResult<FabricationResult> {
  const errors = shapeErrors(resultShape, raw)
  if (errors.length) return fail(errors)
  const result = raw as FabricationResult
  const actualSha256 = sha256(canonicalPayloadJson(result.payload))
  if (result.identity.sha256 !== actualSha256) add(errors, '$.identity.sha256', 'Canonical identity does not match payload')
  const { input, pieces, splitGroups, relations } = result.payload
  if (expectedSha256 && result.identity.sha256 !== expectedSha256) add(errors, '$.identity.sha256', 'Does not match supplied canonical identity')
  const artifactIds = unique(input.artifacts.map(a => a.id), '$.payload.input.artifacts', errors)
  const frames = unique(input.coordinates.frames.map(f => f.id), '$.payload.input.coordinates.frames', errors)
  const transforms = unique(input.coordinates.transforms.map(t => t.id), '$.payload.input.coordinates.transforms', errors)
  for (const [role, id, space] of [['sourceFrameId', input.coordinates.sourceFrameId, 'source-native'], ['analysisFrameId', input.coordinates.analysisFrameId, 'analysis-raster'], ['p004cFrameId', input.coordinates.p004cFrameId, 'p0-04c'], ['canonicalFrameId', input.coordinates.canonicalFrameId, 'fabrication-canonical']] as const) {
    const frame = input.coordinates.frames.find(f => f.id === id); if (!frame || frame.space !== space) add(errors, `$.payload.input.coordinates.${role}`, `Must identify a ${space} frame`)
  }
  requireAll([input.source.artifactId, input.frozenRegionArtifactId, input.frozenVectorArtifactId], artifactIds, '$.payload.input', errors)
  if (input.source.normalizedLayerEvidenceId) requireAll([input.source.normalizedLayerEvidenceId], artifactIds, '$.payload.input.source.normalizedLayerEvidenceId', errors)
  input.coordinates.frames.forEach((f, i) => requireAll([f.sourceArtifactId], artifactIds, `$.payload.input.coordinates.frames[${i}].sourceArtifactId`, errors))
  input.coordinates.transforms.forEach((t, i) => { requireAll([t.fromFrameId, t.toFrameId], frames, `$.payload.input.coordinates.transforms[${i}]`, errors); requireAll(t.evidenceArtifactIds, artifactIds, `$.payload.input.coordinates.transforms[${i}].evidenceArtifactIds`, errors); if (det(t.matrix) === 0) add(errors, `$.payload.input.coordinates.transforms[${i}].matrix`, 'Transform is not invertible') })
  const reachable = (from: string, to: string): boolean => { const seen = new Set([from]); const todo=[from]; while(todo.length){const current=todo.shift()!; for(const t of input.coordinates.transforms.filter(x=>x.fromFrameId===current)){if(t.toFrameId===to)return true;if(!seen.has(t.toFrameId)){seen.add(t.toFrameId);todo.push(t.toFrameId)}}} return false }
  if (!reachable(input.coordinates.sourceFrameId, input.coordinates.analysisFrameId) || !reachable(input.coordinates.analysisFrameId, input.coordinates.p004cFrameId) || !reachable(input.coordinates.p004cFrameId, input.coordinates.canonicalFrameId)) add(errors, '$.payload.input.coordinates.transforms', 'Missing required source→analysis→p0-04c→canonical lineage')
  const checkGeometry = (g: { artifactId: string; frameId: string }, path: string): void => { requireAll([g.artifactId], artifactIds, `${path}.artifactId`, errors); requireAll([g.frameId], frames, `${path}.frameId`, errors) }
  const colors = unique(input.colorSlots.map(x => x.id), '$.payload.input.colorSlots', errors)
  input.colorSlots.forEach((c,i)=>requireAll([c.purificationArtifactId],artifactIds,`$.payload.input.colorSlots[${i}].purificationArtifactId`,errors))
  const regions = unique(input.observedRegions.map(x=>x.id), '$.payload.input.observedRegions', errors)
  input.observedRegions.forEach((r,i)=>{requireAll([r.colorSlotId],colors,`$.payload.input.observedRegions[${i}].colorSlotId`,errors);checkGeometry(r.geometry,`$.payload.input.observedRegions[${i}].geometry`)})
  const pieceIds = unique(pieces.map(x=>x.id), '$.payload.pieces', errors)
  pieces.forEach((p,i)=>{requireAll([p.colorSlotId],colors,`$.payload.pieces[${i}].colorSlotId`,errors);requireAll(p.sourceRegionIds,regions,`$.payload.pieces[${i}].sourceRegionIds`,errors);checkGeometry(p.geometry,`$.payload.pieces[${i}].geometry`)})
  result.payload.baseExposures.forEach((x,i)=>{requireAll([x.sourceRegionId],regions,`$.payload.baseExposures[${i}].sourceRegionId`,errors);requireAll([x.basePieceId],pieceIds,`$.payload.baseExposures[${i}].basePieceId`,errors);if(pieces.find(p=>p.id===x.basePieceId)?.role!=='BASE')add(errors,`$.payload.baseExposures[${i}].basePieceId`,'Must reference BASE piece');checkGeometry(x.geometry,`$.payload.baseExposures[${i}].geometry`)})
  const groupIds=unique(splitGroups.map(x=>x.id),'$.payload.splitGroups',errors), seamIds=new Set<string>()
  splitGroups.forEach((g,i)=>{requireAll(g.sourceRegionIds,regions,`$.payload.splitGroups[${i}].sourceRegionIds`,errors);requireAll(g.pieceIds,pieceIds,`$.payload.splitGroups[${i}].pieceIds`,errors);requireAll(g.partitionEvidenceIds,artifactIds,`$.payload.splitGroups[${i}].partitionEvidenceIds`,errors);g.seams.forEach((s,j)=>{if(seamIds.has(s.id))add(errors,`$.payload.splitGroups[${i}].seams[${j}].id`,'Duplicate seam ID');seamIds.add(s.id);requireAll([...s.pieceIds],pieceIds,`$.payload.splitGroups[${i}].seams[${j}].pieceIds`,errors);if(!g.pieceIds.includes(s.pieceIds[0])||!g.pieceIds.includes(s.pieceIds[1])||s.pieceIds[0]===s.pieceIds[1])add(errors,`$.payload.splitGroups[${i}].seams[${j}].pieceIds`,'Seam must join two distinct pieces in its split group');checkGeometry(s.geometry,`$.payload.splitGroups[${i}].seams[${j}].geometry`);requireAll([s.measurementEvidenceId],artifactIds,`$.payload.splitGroups[${i}].seams[${j}].measurementEvidenceId`,errors)})})
  pieces.forEach((p,i)=>{if(p.splitGroupId){requireAll([p.splitGroupId],groupIds,`$.payload.pieces[${i}].splitGroupId`,errors);if(!splitGroups.find(g=>g.id===p.splitGroupId)?.pieceIds.includes(p.id))add(errors,`$.payload.pieces[${i}].splitGroupId`,'Split group does not include piece')}})
  const relationIds=unique(relations.map(r=>r.id),'$.payload.relations',errors), assembly=new Map<string,string[]>()
  relations.forEach((r,i)=>{const base=`$.payload.relations[${i}]`;if(r.status==='RESOLVED'?!r.direction:r.direction!==null)add(errors,`${base}.direction`,'Direction must exist exactly for RESOLVED relation');if((r.status==='RESOLVED'||r.status==='NO_RELATION')&&r.evidenceArtifactIds.length===0)add(errors,`${base}.evidenceArtifactIds`,'Resolved decisions require evidence');requireAll(r.evidenceArtifactIds,artifactIds,`${base}.evidenceArtifactIds`,errors);const endpoints=r.kind==='VISUAL_OCCLUSION_RELATION'?regions:pieceIds;requireAll([r.a,r.b],endpoints,base,errors);if(r.a===r.b)add(errors,base,'Relation endpoints must differ');if(r.kind==='ASSEMBLY_PRECEDENCE'&&r.status==='RESOLVED'){const [from,to]=r.direction==='A_TO_B'?[r.a,r.b]:[r.b,r.a];assembly.set(from,[...(assembly.get(from)??[]),to])}})
  const visiting=new Set<string>(),visited=new Set<string>();const cycle=(id:string):boolean=>{if(visiting.has(id))return true;if(visited.has(id))return false;visiting.add(id);const found=(assembly.get(id)??[]).some(cycle);visiting.delete(id);visited.add(id);return found}; if([...pieceIds].some(cycle))add(errors,'$.payload.relations','Assembly precedence graph contains a cycle')
  if (!relationIds.size && result.payload.relationCoverage.some(c=>c.status==='COMPLETE')) add(errors,'$.payload.relationCoverage','COMPLETE coverage needs recorded evidence/relations')
  return errors.length ? fail(errors) : pass(result)
}

export function validateStructuralAssessment(raw: unknown, result: FabricationResult): ValidationResult<StructuralAssessment> {
  const errors=shapeErrors(structureShape,raw);if(errors.length)return fail(errors);const assessment=raw as StructuralAssessment; if(assessment.resultSha256!==result.identity.sha256)add(errors,'$.resultSha256','Assessment does not bind this canonical result');const evidence=new Set([...result.payload.input.artifacts.map(x=>x.id),...assessment.evidenceArtifacts.map(x=>x.id)]);Object.entries(assessment.checks).forEach(([key,g])=>{requireAll(g.evidenceArtifactIds,evidence,`$.checks.${key}.evidenceArtifactIds`,errors);if(g.status==='PASS'&&!gatePass(g))add(errors,`$.checks.${key}`,'PASS requires evidence')});const blocking=result.payload.relations.some(r=>r.status==='UNRESOLVED'&&r.fabricationImpact==='BLOCKING');if(blocking&&assessment.status==='PASS')add(errors,'$.status','Blocking unresolved relation prevents structural PASS');if(result.payload.input.source.adapter.status==='UNSUPPORTED'&&assessment.status==='PASS')add(errors,'$.status','Unsupported source adapter prevents structural PASS');if(assessment.status==='PASS'&&!allPass(assessment.checks))add(errors,'$.status','Structural PASS requires every check PASS');return errors.length?fail(errors):pass(assessment)
}

export function validateManufacturingAssessment(raw: unknown,result: FabricationResult): ValidationResult<ManufacturingAssessment>{const errors=shapeErrors(manufacturingShape,raw);if(errors.length)return fail(errors);const a=raw as ManufacturingAssessment;if(a.resultSha256!==result.identity.sha256)add(errors,'$.resultSha256','Assessment does not bind this canonical result');const evidence=new Set([...result.payload.input.artifacts.map(x=>x.id),...a.evidenceArtifacts.map(x=>x.id)]);requireAll([a.calibrationArtifactId],evidence,'$.calibrationArtifactId',errors);requireAll(a.physicalTransform.evidenceArtifactIds,evidence,'$.physicalTransform.evidenceArtifactIds',errors);if(a.physicalTransform.fromFrameId!==result.payload.input.coordinates.canonicalFrameId)add(errors,'$.physicalTransform.fromFrameId','Must originate at canonical frame');if(a.physicalTransform.toFrameId!==a.physicalFrame.id)add(errors,'$.physicalTransform.toFrameId','Must target physical-mm frame');if(det(a.physicalTransform.matrix)===0)add(errors,'$.physicalTransform.matrix','Transform is not invertible');const [x,y,w,h]=a.physicalFrame.bounds;if(x!==0||y!==0||w!==a.target.widthMm||h!==a.target.heightMm)add(errors,'$.physicalFrame.bounds','Must match target dimensions at top-left origin');const m=a.physicalTransform.matrix;if(m[1]!==0||m[2]!==0||m[0]!==m[3]||m[0]<=0)add(errors,'$.physicalTransform.matrix','PRESERVE requires positive uniform axis-aligned scale');const canonical=result.payload.input.coordinates.frames.find(f=>f.id===result.payload.input.coordinates.canonicalFrameId)!;if(m[0]*canonical.bounds[2]!==a.target.widthMm||m[3]*canonical.bounds[3]!==a.target.heightMm||m[0]*canonical.bounds[0]+m[4]!==0||m[3]*canonical.bounds[1]+m[5]!==0)add(errors,'$.physicalTransform.matrix','Must map canonical bounds exactly to current physical target');const seams=result.payload.splitGroups.flatMap(g=>g.seams);if(a.seamMetrics.count!==seams.length)add(errors,'$.seamMetrics.count','Must equal canonical AddedSeam count');const metricIds=unique(a.seamMetrics.seams.map(s=>s.seamId),'$.seamMetrics.seams',errors);requireAll(seams.map(s=>s.id),metricIds,'$.seamMetrics.seams',errors);const seamById=new Map(seams.map(s=>[s.id,s]));let total=0;a.seamMetrics.seams.forEach((s,i)=>{total+=s.lengthMm;const canonicalSeam=seamById.get(s.seamId);if(canonicalSeam&&Math.abs(s.lengthMm-canonicalSeam.lengthCanonical*m[0])>1e-9)add(errors,`$.seamMetrics.seams[${i}].lengthMm`,'Must be derived from canonical seam and physical transform');requireAll(s.acceptance.evidenceArtifactIds,evidence,`$.seamMetrics.seams[${i}].acceptance.evidenceArtifactIds`,errors);if(s.acceptance.status==='PASS'&&!gatePass(s.acceptance))add(errors,`$.seamMetrics.seams[${i}].acceptance`,'PASS requires evidence')});if(a.status==='PASS'&&a.seamMetrics.seams.some(s=>s.acceptance.status!=='PASS'))add(errors,'$.status','Manufacturing PASS requires every seam acceptance PASS');if(Math.abs(total-a.seamMetrics.totalLengthMm)>1e-9)add(errors,'$.seamMetrics.totalLengthMm','Must equal recorded seam lengths');Object.entries(a.checks).forEach(([key,g])=>{requireAll(g.evidenceArtifactIds,evidence,`$.checks.${key}.evidenceArtifactIds`,errors);if(g.status==='PASS'&&!gatePass(g))add(errors,`$.checks.${key}`,'PASS requires evidence')});if(a.status==='PASS'&&(!allPass(a.checks)||(seams.length>0&&!a.review)))add(errors,'$.status','Manufacturing PASS requires passing checks and split review');return errors.length?fail(errors):pass(a)}

export function exportEligibility(result: FabricationResult, structural: StructuralAssessment, assessments: ManufacturingAssessment[], target: ManufacturingAssessment['target']): { eligible: boolean; reasons: string[] } { const reasons:string[]=[];if(!validateFabricationResult(result).ok)reasons.push('CANONICAL_RESULT_INVALID');if(!validateStructuralAssessment(structural,result).ok||structural.status!=='PASS')reasons.push('STRUCTURAL_ASSESSMENT_NOT_PASS');const current=assessments.filter(a=>a.resultSha256===result.identity.sha256&&a.target.widthMm===target.widthMm&&a.target.heightMm===target.heightMm&&a.target.profileId===target.profileId&&a.target.profileVersion===target.profileVersion&&a.target.calibrationSha256===target.calibrationSha256);if(!current.some(a=>validateManufacturingAssessment(a,result).ok&&a.status==='PASS'))reasons.push('CURRENT_MANUFACTURING_ASSESSMENT_NOT_PASS');if(result.payload.relations.some(r=>r.status==='UNRESOLVED'&&r.fabricationImpact==='BLOCKING'))reasons.push('BLOCKING_RELATION_UNRESOLVED');return {eligible:reasons.length===0,reasons}}

/** Read-only legacy consumer: no V0 mutation, inference, or FLD fixture construction. */
export function adaptB2V0ObservedOnly(input: FabricationInput, legacy: { pieces: readonly { sourceRegionIds?: unknown; sourceComponentIds?: unknown; observedGeometry?: unknown; representativeColor?: unknown }[] }, geometryFor: (legacyPiece: unknown, index: number) => { artifactId: string; objectId: string; frameId: string }, colorSlotFor: (legacyPiece: unknown, index: number) => string): ObservedCandidate { return {schemaVersion:'b2.observed-candidate/1',input,status:'NOT_EVALUATED',unspecifiedRelation:'NOT_EVALUATED',regions:legacy.pieces.map((piece,index)=>({id:`legacy-observed-${index+1}`,componentIds:Array.isArray(piece.sourceComponentIds)?piece.sourceComponentIds.filter((v):v is string=>typeof v==='string'):[],colorSlotId:colorSlotFor(piece,index),geometry:geometryFor(piece,index)}))} }

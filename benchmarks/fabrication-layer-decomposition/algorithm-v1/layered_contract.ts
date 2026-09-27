/** Versioned, non-frozen layered result contract. Not a b2.result/1 verdict.
 * Geometry semantics require the independent Python persisted-domain verifier.
 */
import { canonicalPayloadJson, validateFabricationInput } from '../../../src/shared/contracts/fabrication-validation'
declare const require: any
declare const module: any
declare const process: any

export const VERSION = 'fabrication.layered-result/1'
const object = (x: any): boolean => x !== null && typeof x === 'object' && !Array.isArray(x)
const strings = (x: any): boolean => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0) && new Set(x).size === x.length
function finite(x: any): boolean { return Array.isArray(x) ? x.every(finite) : typeof x === 'number' && Number.isFinite(x) }
function geometry(x: any): boolean {
  return object(x) && ((['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(x.type) && Array.isArray(x.coordinates) && finite(x.coordinates)) || (x.type === 'GeometryCollection' && Array.isArray(x.geometries) && x.geometries.every(geometry)))
}
function validateBody(result: any): any {
  const errors: string[] = []
  const fail = (message: string): void => { errors.push(message) }
  if (!object(result) || result.schemaVersion !== VERSION || !object(result.payload) || !object(result.identity)) return { ok: false, errors: ['Expected versioned layered result'] }
  const p = result.payload
  const input = validateFabricationInput(p.input)
  if (!input.ok) fail('Embedded shared FabricationInput rejected')
  if (result.identity.contractVersion !== VERSION || result.identity.identityMode !== 'CANONICAL_JSON_LF_UTF8') fail('Wrong identity contract')
  const hash = require('node:crypto').createHash('sha256').update(canonicalPayloadJson(p), 'utf8').digest('hex')
  if (hash !== result.identity.sha256) fail('Layered payload identity mismatch')
  if (!Array.isArray(p.pieces) || !p.pieces.length || !strings(p.bottomToTop)) return { ok: false, errors: [...errors, 'Missing pieces/order'], input }
  const ids = p.pieces.map((v: any) => v.id)
  const slots = new Map((Array.isArray(p.input?.colorSlots) ? p.input.colorSlots : []).map((v: any) => [v.id, v.rgb]))
  const components = new Map<string, string>()
  for (const region of (Array.isArray(p.input?.observedRegions) ? p.input.observedRegions : [])) {
    for (const id of (Array.isArray(region.componentIds) ? region.componentIds : [])) components.set(id, region.id)
  }
  if (!strings(ids) || p.bottomToTop.length !== ids.length || !p.bottomToTop.every((id: string) => ids.includes(id))) fail('Order must include every unique piece')
  for (const piece of p.pieces) {
    if (!object(piece) || typeof piece.colorSlotId !== 'string' || !Array.isArray(piece.rgb) || piece.rgb.length !== 3 || !piece.rgb.every((v: any) => Number.isInteger(v) && v >= 0 && v <= 255)) { fail('Invalid piece color'); continue }
    if (!strings(piece.sourceComponentIds) || !piece.sourceComponentIds.length || !strings(piece.sourceRegionIds) || !piece.sourceRegionIds.length || !strings(piece.occluderIds)) fail('Invalid source/occluder references')
    else if (piece.sourceComponentIds.some((id: string) => !components.has(id) || !piece.sourceRegionIds.includes(components.get(id)))) fail('Dangling or cross-region source reference')
    if (JSON.stringify(slots.get(piece.colorSlotId)) !== JSON.stringify(piece.rgb)) fail('Piece exact palette differs from embedded input')
    if (!geometry(piece.full) || piece.full.type !== 'Polygon' || !geometry(piece.visible) || !geometry(piece.hidden)) fail('Invalid persisted geometry')
    if (typeof piece.inferredHiddenGeometry !== 'boolean' || piece.sourceDomainRole !== 'OBSERVED_VISIBLE_ONLY' || piece.completionEvidenceStatus !== 'GENERATION_HYPOTHESIS_NOT_OBSERVED_SOURCE') fail('Hidden geometry must be explicitly inferred, not an observed source')
    if (!Array.isArray(piece.completionEvidence) || !piece.completionEvidence.length || piece.completionEvidence.some((e: any) => !object(e) || typeof e.method !== 'string' || !e.method || typeof e.inferredHiddenGeometry !== 'boolean')) fail('Missing typed completion hypothesis evidence')
    if (piece.occluderIds.some((id: string) => !ids.includes(id) || p.bottomToTop.indexOf(id) <= p.bottomToTop.indexOf(piece.id))) fail('Occluder must be an actual higher piece')
  }
  if (!Array.isArray(p.occlusionEdges) || !Array.isArray(p.physicalSeams)) fail('Missing actual relations/seams')
  else {
    const edgeKeys = new Set<string>()
    for (const edge of p.occlusionEdges) {
      const a = p.bottomToTop.indexOf(edge.belowPieceId), b = p.bottomToTop.indexOf(edge.abovePieceId)
      const key = JSON.stringify([edge.belowPieceId, edge.abovePieceId])
      if (a < 0 || b < 0 || a >= b || edgeKeys.has(key)) fail('Invalid/duplicate/cyclic occlusion edge')
      edgeKeys.add(key)
    }
    const seamIds = new Set<string>()
    for (const seam of p.physicalSeams) {
      if (typeof seam.id !== 'string' || seamIds.has(seam.id) || !strings(seam.pieceIds) || seam.pieceIds.length !== 2 || seam.pieceIds.some((id: string) => !ids.includes(id)) || !geometry(seam.geometry) || !['LineString','MultiLineString'].includes(seam.geometry.type) || !Number.isFinite(seam.lengthCanonical) || seam.lengthCanonical <= 0) fail('Invalid physical seam')
      if (!Number.isFinite(seam.visibleLengthCanonical) || seam.visibleLengthCanonical < 0 || seam.visibleLengthCanonical > seam.lengthCanonical + 1e-8) fail('Invalid visible physical seam length')
      seamIds.add(seam.id)
    }
  }
  if (p.manufacturing !== 'NOT_EVALUATED' || p.productionExportEligible !== 'NO' || p.userVisualAcceptance !== 'PENDING') fail('Layered candidate cannot claim manufacturing or visual acceptance')
  if (p.orderSemantics !== 'PROPOSED_FABRICATION_NOT_ORIGINAL_LAYER_HISTORY') fail('Proposed fabrication order cannot claim original author layer history')
  return { ok: errors.length === 0, errors, input, contractVersion: VERSION, geometrySemantics: 'REQUIRES_INDEPENDENT_PERSISTED_DOMAIN_REPLAY' }
}
export function validateLayeredResult(result: any): any {
  // Public reusable validator fails closed for arbitrary decoded JSON, not
  // just well-shaped records emitted by this runtime.
  try { return validateBody(result) }
  catch (error) { return { ok: false, errors: ['Malformed layered contract: ' + String(error)] } }
}
if (require.main === module) {
  try {
    const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'))
    const result = request.result
    if (request.sign_result && object(result) && object(result.identity) && object(result.payload)) result.identity.sha256 = require('node:crypto').createHash('sha256').update(canonicalPayloadJson(result.payload), 'utf8').digest('hex')
    const response = validateLayeredResult(result)
    if (request.sign_result) response.signedResult = result
    process.stdout.write(JSON.stringify(response) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ok: false, errors: ['Malformed layered request: ' + String(error)]}) + '\n')
  }
}

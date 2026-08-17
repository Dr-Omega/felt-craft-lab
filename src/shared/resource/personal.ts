import { FELT_RESOURCE_PROTOCOL } from './constants'
import { parseFeltResourceRef } from './parse'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface PersonalAssetSourceRefParts {
  ref: string
  personalAssetId: string
  versionId: string
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Build the only persisted source-image ref allowed for a Personal Asset Version. */
export function buildPersonalAssetSourceRef(
  personalAssetId: string,
  versionId: string
): string | undefined {
  if (!isUuid(personalAssetId) || !isUuid(versionId)) return undefined
  return `${FELT_RESOURCE_PROTOCOL}//personal/${personalAssetId}/${versionId}/source.png`
}

/** Parse and verify the canonical Personal Asset source-image ref shape. */
export function parsePersonalAssetSourceRef(value: unknown): PersonalAssetSourceRefParts | undefined {
  const parsed = parseFeltResourceRef(value)
  if (!parsed || parsed.kind !== 'personal') return undefined

  const parts = parsed.relativePath.split('/')
  if (parts.length !== 3 || parts[2] !== 'source.png') return undefined
  const [personalAssetId, versionId] = parts
  const ref = buildPersonalAssetSourceRef(personalAssetId, versionId)
  if (!ref || ref !== parsed.ref) return undefined

  return { ref, personalAssetId, versionId }
}

export function isPersonalAssetSourceRefFor(
  value: unknown,
  personalAssetId: string,
  versionId: string
): value is string {
  const parsed = parsePersonalAssetSourceRef(value)
  return parsed?.personalAssetId === personalAssetId && parsed.versionId === versionId
}

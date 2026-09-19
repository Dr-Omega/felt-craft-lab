/**
 * Align with scripts/build-ywn-manifest.py content_projection.
 * Version identity = semantic fields + logical media name + sha256 (NOT snapshot ResourceRefs).
 * Authoritative regressions live in the Python builder tests.
 */

export type MediaIdentity = {
  logicalName: string
  sha256: string
}

export type ContentProjection = {
  type: unknown
  themeId: unknown
  categoryIds: unknown[]
  nameZh: unknown
  nameEn: unknown
  introZh: unknown
  keywords: unknown[]
  image: MediaIdentity
  thumbnail: MediaIdentity
  preSplit: MediaIdentity
  audio: {
    nameZh: MediaIdentity
    nameEn: MediaIdentity
    introZh: MediaIdentity
  }
  source: string
  license: string
}

export type PriorContentVersion = {
  contentVersion: number
  projection: ContentProjection
}

function emptyIdentity(): MediaIdentity {
  return { logicalName: '', sha256: '' }
}

function logicalNameFromRef(ref: unknown): string {
  if (typeof ref !== 'string' || !ref) return ''
  const parts = ref.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || ''
}

function asIdentity(value: unknown, fallbackName = '', fallbackHash = ''): MediaIdentity {
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return {
      logicalName: typeof row.logicalName === 'string' ? row.logicalName : fallbackName,
      sha256: typeof row.sha256 === 'string' ? row.sha256 : fallbackHash
    }
  }
  if (typeof value === 'string') {
    return { logicalName: fallbackName, sha256: value || fallbackHash }
  }
  return { logicalName: fallbackName, sha256: fallbackHash }
}

export function contentProjection(
  record: Record<string, unknown>,
  media?: Partial<Record<'image' | 'thumbnail' | 'preSplit' | 'nameZhAudio' | 'nameEnAudio' | 'introZhAudio', MediaIdentity | string>>
): ContentProjection {
  const audio = (record.audio && typeof record.audio === 'object' ? record.audio : {}) as Record<
    string,
    unknown
  >
  const supplied = media ?? {}
  const legacyHashes =
    record.mediaHashes && typeof record.mediaHashes === 'object'
      ? (record.mediaHashes as Record<string, unknown>)
      : {}

  return {
    type: record.type,
    themeId: record.themeId,
    categoryIds: Array.isArray(record.categoryIds) ? [...record.categoryIds] : [],
    nameZh: record.nameZh,
    nameEn: record.nameEn,
    introZh: record.introZh,
    keywords: Array.isArray(record.keywords) ? [...record.keywords] : [],
    image: asIdentity(
      supplied.image ?? record.image ?? legacyHashes.image,
      logicalNameFromRef(record.imageUrl),
      typeof legacyHashes.image === 'string' ? legacyHashes.image : ''
    ),
    thumbnail: asIdentity(
      supplied.thumbnail ?? record.thumbnail ?? legacyHashes.thumbnail,
      logicalNameFromRef(record.thumbnailUrl),
      typeof legacyHashes.thumbnail === 'string' ? legacyHashes.thumbnail : ''
    ),
    preSplit: asIdentity(
      supplied.preSplit ?? record.preSplit ?? legacyHashes.preSplit,
      logicalNameFromRef(record.preSplitDataUrl),
      typeof legacyHashes.preSplit === 'string' ? legacyHashes.preSplit : ''
    ),
    audio: {
      nameZh: asIdentity(
        supplied.nameZhAudio ?? audio.nameZh ?? legacyHashes.nameZhAudio,
        logicalNameFromRef(audio.nameZhUrl),
        typeof legacyHashes.nameZhAudio === 'string' ? legacyHashes.nameZhAudio : ''
      ),
      nameEn: asIdentity(
        supplied.nameEnAudio ?? audio.nameEn ?? legacyHashes.nameEnAudio,
        logicalNameFromRef(audio.nameEnUrl),
        typeof legacyHashes.nameEnAudio === 'string' ? legacyHashes.nameEnAudio : ''
      ),
      introZh: asIdentity(
        supplied.introZhAudio ?? audio.introZh ?? legacyHashes.introZhAudio,
        logicalNameFromRef(audio.introZhUrl),
        typeof legacyHashes.introZhAudio === 'string' ? legacyHashes.introZhAudio : ''
      )
    },
    source: typeof record.source === 'string' ? record.source : '',
    license: typeof record.license === 'string' ? record.license : ''
  }
}

export function resolveContentVersion(
  assetId: string,
  projection: ContentProjection,
  prior: Record<string, PriorContentVersion>
): number {
  const prev = prior[assetId]
  if (!prev) return 1
  const oldVersion = Number.isFinite(prev.contentVersion) ? prev.contentVersion : 1
  if (JSON.stringify(prev.projection) === JSON.stringify(projection)) {
    return oldVersion
  }
  return oldVersion + 1
}

export { emptyIdentity }

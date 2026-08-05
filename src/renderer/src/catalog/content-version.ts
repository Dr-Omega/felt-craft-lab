/**
 * Runtime projection used to continue AssetRecord.contentVersion across Manifest rebuilds.
 * Keep field list aligned with scripts/build-ywn-manifest.py (including mediaHashes).
 * Authoritative bump logic + regressions live in the Python builder tests.
 */

export type MediaHashes = {
  image: string
  thumbnail: string
  preSplit: string
  nameZhAudio: string
  nameEnAudio: string
  introZhAudio: string
}

export type ContentProjection = {
  type: unknown
  themeId: unknown
  categoryIds: unknown[]
  nameZh: unknown
  nameEn: unknown
  introZh: unknown
  keywords: unknown[]
  imageUrl: string
  thumbnailUrl: string
  preSplitDataUrl: string
  audio: {
    nameZhUrl: string
    nameEnUrl: string
    introZhUrl: string
  }
  source: string
  license: string
  mediaHashes: MediaHashes
}

export type PriorContentVersion = {
  contentVersion: number
  projection: ContentProjection
}

function emptyHashes(): MediaHashes {
  return {
    image: '',
    thumbnail: '',
    preSplit: '',
    nameZhAudio: '',
    nameEnAudio: '',
    introZhAudio: ''
  }
}

export function contentProjection(
  record: Record<string, unknown>,
  mediaHashes?: Partial<MediaHashes>
): ContentProjection {
  const audio = (record.audio && typeof record.audio === 'object' ? record.audio : {}) as Record<
    string,
    unknown
  >
  const fromRecord =
    record.mediaHashes && typeof record.mediaHashes === 'object'
      ? (record.mediaHashes as Record<string, unknown>)
      : {}
  const hashes = {
    ...emptyHashes(),
    ...(typeof fromRecord.image === 'string' ? { image: fromRecord.image } : {}),
    ...(typeof fromRecord.thumbnail === 'string' ? { thumbnail: fromRecord.thumbnail } : {}),
    ...(typeof fromRecord.preSplit === 'string' ? { preSplit: fromRecord.preSplit } : {}),
    ...(typeof fromRecord.nameZhAudio === 'string' ? { nameZhAudio: fromRecord.nameZhAudio } : {}),
    ...(typeof fromRecord.nameEnAudio === 'string' ? { nameEnAudio: fromRecord.nameEnAudio } : {}),
    ...(typeof fromRecord.introZhAudio === 'string' ? { introZhAudio: fromRecord.introZhAudio } : {}),
    ...mediaHashes
  }
  return {
    type: record.type,
    themeId: record.themeId,
    categoryIds: Array.isArray(record.categoryIds) ? [...record.categoryIds] : [],
    nameZh: record.nameZh,
    nameEn: record.nameEn,
    introZh: record.introZh,
    keywords: Array.isArray(record.keywords) ? [...record.keywords] : [],
    imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : '',
    thumbnailUrl: typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl : '',
    preSplitDataUrl: typeof record.preSplitDataUrl === 'string' ? record.preSplitDataUrl : '',
    audio: {
      nameZhUrl: typeof audio.nameZhUrl === 'string' ? audio.nameZhUrl : '',
      nameEnUrl: typeof audio.nameEnUrl === 'string' ? audio.nameEnUrl : '',
      introZhUrl: typeof audio.introZhUrl === 'string' ? audio.introZhUrl : ''
    },
    source: typeof record.source === 'string' ? record.source : '',
    license: typeof record.license === 'string' ? record.license : '',
    mediaHashes: hashes
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

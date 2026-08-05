/**
 * Runtime projection used to continue AssetRecord.contentVersion across Manifest rebuilds.
 * Keep field list aligned with scripts/build-ywn-manifest.py.
 */

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
}

export type PriorContentVersion = {
  contentVersion: number
  projection: ContentProjection
}

export function contentProjection(record: Record<string, unknown>): ContentProjection {
  const audio = (record.audio && typeof record.audio === 'object' ? record.audio : {}) as Record<
    string,
    unknown
  >
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

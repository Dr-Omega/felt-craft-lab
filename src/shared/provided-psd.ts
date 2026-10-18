export const PROVIDED_PSD_KEYS = ['fuwa', 'hongbao', 'jiaozi', 'denglong', 'beijing'] as const
export type ProvidedPsdKey = typeof PROVIDED_PSD_KEYS[number]

/** Pinned authored masks; only colors may change. Stored with the immutable personal version. */
export interface ProvidedPsdEdit {
  schemaVersion: 'provided-psd-edit/1'
  sourceKey: ProvidedPsdKey
  sourceSha256: string
  colors: string[] // visible PSD layers, bottom to top; hidden paper never participates
}

export function validProvidedPsdEdit(raw: unknown): raw is ProvidedPsdEdit {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as ProvidedPsdEdit
  return Object.keys(value).every(key => ['schemaVersion', 'sourceKey', 'sourceSha256', 'colors'].includes(key)) &&
    value.schemaVersion === 'provided-psd-edit/1' && PROVIDED_PSD_KEYS.includes(value.sourceKey) &&
    typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256) &&
    Array.isArray(value.colors) && value.colors.length > 0 && value.colors.length <= 512 &&
    value.colors.every(color => typeof color === 'string' && /^#[0-9A-F]{6}$/.test(color))
}

/**
 * 将固定/动态音频引用转为 Howler 可播放地址。
 *
 * Electron 正式对接：felt-resource://audio/...
 * 浏览器 Flask demo：可降级为 /generated-audio/...（非正式对接地址）
 */

const FELT_AUDIO_PREFIX = 'felt-resource://audio/'

export function isFeltResourceAudioRef(url: string): boolean {
  return typeof url === 'string' && url.startsWith(FELT_AUDIO_PREFIX)
}

/** felt-resource://audio/a/b.mp3 → a/b.mp3 */
export function feltAudioRelativePath(url: string): string | null {
  if (!isFeltResourceAudioRef(url)) return null
  const rel = url.slice(FELT_AUDIO_PREFIX.length).replace(/^\/+/, '')
  if (!rel || rel.includes('..') || rel.includes('\\')) return null
  return rel
}

export function isElectronRenderer(): boolean {
  try {
    const g = globalThis as unknown as {
      window?: { electronAPI?: unknown }
      electronAPI?: unknown
    }
    return Boolean(g.window?.electronAPI || g.electronAPI)
  } catch {
    return false
  }
}

/**
 * @param url ResourceRef 或 http(s) / 相对路径
 * @param options.httpFallbackBase 仅非 Electron 时，把 felt-resource 映射到 HTTP（如 "" 或 "http://127.0.0.1:8788"）
 */
export function toPlayableAudioUrl(
  url: string,
  options: { httpFallbackBase?: string; forceHttpFallback?: boolean } = {}
): string {
  if (!url) return ''
  const rel = feltAudioRelativePath(url)
  if (rel) {
    const useHttp = options.forceHttpFallback === true || !isElectronRenderer()
    if (!useHttp) return url
    const base = (options.httpFallbackBase || '').replace(/\/$/, '')
    return `${base}/generated-audio/${rel}`
  }
  return url
}

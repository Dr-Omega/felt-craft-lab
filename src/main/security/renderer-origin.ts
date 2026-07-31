/**
 * Precise Renderer trust policy.
 * Call configureTrustedRendererTargets() once Main knows the actual load URL.
 */

const allowedExactUrls = new Set<string>()
const allowedDevOrigin = {
  value: null as string | null
}

function normalizeHttpUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hash = ''
  // Keep search empty for trust comparisons.
  url.search = ''
  let href = url.href
  if (url.pathname === '/' && href.endsWith('/')) {
    // already normalized
  }
  return href
}

function normalizeFileUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  let pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/')
  pathname = pathname.replace(/^\/([a-zA-Z]):/, (_, drive: string) => `/${drive.toUpperCase()}:`)
  // Drop trailing slash differences for files.
  if (pathname.endsWith('/')) pathname = pathname.slice(0, -1)
  return `file://${pathname}`
}

function normalizeTrustedUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') return normalizeHttpUrl(rawUrl)
    if (url.protocol === 'file:') return normalizeFileUrl(rawUrl)
    return undefined
  } catch {
    return undefined
  }
}

/** Reset and bind the exact renderer targets this process will load. */
export function configureTrustedRendererTargets(options: {
  devRendererUrl?: string
  packagedRendererFileUrl?: string
}): void {
  allowedExactUrls.clear()
  allowedDevOrigin.value = null

  if (options.devRendererUrl) {
    const normalized = normalizeTrustedUrl(options.devRendererUrl)
    if (normalized) {
      const url = new URL(normalized)
      allowedDevOrigin.value = url.origin
      allowedExactUrls.add(normalized)
      // Vite usually serves `/` for the renderer entry.
      allowedExactUrls.add(`${url.origin}/`)
      if (url.pathname !== '/' && url.pathname !== '') {
        allowedExactUrls.add(`${url.origin}/`)
      }
    }
  }

  if (options.packagedRendererFileUrl) {
    const normalized = normalizeTrustedUrl(options.packagedRendererFileUrl)
    if (normalized) allowedExactUrls.add(normalized)
  }
}

export function resetTrustedRendererTargetsForTests(): void {
  allowedExactUrls.clear()
  allowedDevOrigin.value = null
}

/**
 * Returns true only for the configured exact renderer entry URL(s).
 * Other localhost ports/paths and arbitrary .../renderer/index.html are rejected.
 */
export function isAllowedRendererUrl(rawUrl: string): boolean {
  const normalized = normalizeTrustedUrl(rawUrl)
  if (!normalized) return false

  if (allowedExactUrls.has(normalized)) return true

  // Dev: allow only the bound origin's exact entry URLs already inserted above.
  // Reject other ports/paths on localhost even if hostname matches a common pattern.
  try {
    const url = new URL(normalized)
    if (
      allowedDevOrigin.value &&
      url.origin === allowedDevOrigin.value &&
      (url.pathname === '/' || url.pathname === '')
    ) {
      return allowedExactUrls.has(`${url.origin}/`) || allowedExactUrls.has(normalized)
    }
  } catch {
    return false
  }

  return false
}

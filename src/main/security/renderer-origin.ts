/**
 * Renderer URL allow-list for IPC sender checks and navigation locks.
 * Dev Vite origin and packaged file renderer are accepted; everything else is denied.
 */
export function isAllowedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    }

    if (url.protocol === 'file:') {
      const path = decodeURIComponent(url.pathname).replace(/\\/g, '/').toLowerCase()
      return path.endsWith('/renderer/index.html') || path.endsWith('/out/renderer/index.html')
    }

    return false
  } catch {
    return false
  }
}

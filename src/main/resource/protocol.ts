import { protocol } from 'electron'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { FELT_RESOURCE_SCHEME } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceRoots } from '@shared/resource'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.json': 'application/json'
}

/** Must run before app ready. */
export function registerFeltResourceScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FELT_RESOURCE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: false
      }
    }
  ])
}

export function attachFeltResourceProtocol(roots: ResourceRoots): void {
  protocol.handle(FELT_RESOURCE_SCHEME, (request) => {
    const resolved = resolveFeltResourcePath(request.url, roots, { requireExists: true })
    if (!resolved.ok) {
      return new Response(resolved.error.message, {
        status: resolved.error.code === 'ASSET_NOT_FOUND' ? 404 : 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }

    try {
      const body = readFileSync(resolved.absolutePath)
      const mime = MIME_BY_EXT[extname(resolved.absolutePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': mime,
          'cache-control': 'no-cache'
        }
      })
    } catch {
      return new Response('资源读取失败。', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
  })
}

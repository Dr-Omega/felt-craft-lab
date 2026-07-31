import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { FELT_RESOURCE_SCHEME } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceRoots } from '@shared/resource'

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
        // Required so Renderer can draw felt-resource images onto canvas without tainting.
        corsEnabled: true
      }
    }
  ])
}

async function toCorsResponse(upstream: Response): Promise<Response> {
  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
}

/**
 * Serve local files through Electron's streaming fetch path so audio seek /
 * range requests work without buffering the whole file in Main.
 */
export function attachFeltResourceProtocol(roots: ResourceRoots): void {
  protocol.handle(FELT_RESOURCE_SCHEME, async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      })
    }

    const resolved = resolveFeltResourcePath(request.url, roots, { requireExists: true })
    if (!resolved.ok) {
      return new Response(resolved.error.message, {
        status: resolved.error.code === 'ASSET_NOT_FOUND' ? 404 : 400,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    try {
      const upstream = await net.fetch(pathToFileURL(resolved.absolutePath).href, {
        headers: request.headers,
        method: request.method
      })
      return await toCorsResponse(upstream)
    } catch {
      return new Response('资源读取失败。', {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
  })
}

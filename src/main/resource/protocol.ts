import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { FELT_RESOURCE_SCHEME } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceRoots } from '@shared/resource'
import {
  FELT_RESOURCE_ALLOW_HEADER,
  isFeltResourceMethodAllowed,
  methodNotAllowedResponse
} from './methods'

export { isFeltResourceMethodAllowed, methodNotAllowedResponse } from './methods'

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
        corsEnabled: true
      }
    }
  ])
}

function corsHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', FELT_RESOURCE_ALLOW_HEADER)
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  headers.set('Allow', FELT_RESOURCE_ALLOW_HEADER)
  return headers
}

async function toCorsResponse(upstream: Response): Promise<Response> {
  const headers = corsHeaders()
  upstream.headers.forEach((value, key) => {
    headers.set(key, value)
  })
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', FELT_RESOURCE_ALLOW_HEADER)
  headers.set('Allow', FELT_RESOURCE_ALLOW_HEADER)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
}

/**
 * Production request handler used by protocol.handle and Electron smoke.
 */
export async function handleFeltResourceRequest(
  request: Request,
  roots: ResourceRoots
): Promise<Response> {
  const method = request.method.toUpperCase()

  if (!isFeltResourceMethodAllowed(method)) {
    return methodNotAllowedResponse()
  }

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders({ 'Access-Control-Max-Age': '86400' })
    })
  }

  const resolved = resolveFeltResourcePath(request.url, roots, { requireExists: true })
  if (!resolved.ok) {
    return new Response(resolved.error.message, {
      status: resolved.error.code === 'ASSET_NOT_FOUND' ? 404 : 400,
      headers: corsHeaders({ 'content-type': 'text/plain; charset=utf-8' })
    })
  }

  try {
    const upstream = await net.fetch(pathToFileURL(resolved.absolutePath).href, {
      headers: request.headers,
      method
    })
    return await toCorsResponse(upstream)
  } catch {
    return new Response('资源读取失败。', {
      status: 500,
      headers: corsHeaders({ 'content-type': 'text/plain; charset=utf-8' })
    })
  }
}

export function attachFeltResourceProtocol(roots: ResourceRoots): void {
  protocol.handle(FELT_RESOURCE_SCHEME, (request) => handleFeltResourceRequest(request, roots))
}

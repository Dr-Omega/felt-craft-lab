import { net, protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { FELT_RESOURCE_SCHEME } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceRoots } from '@shared/resource'
import {
  FELT_RESOURCE_ALLOW_HEADER,
  isFeltResourceMethodAllowed,
  methodNotAllowedResponse
} from './methods'
import { parseFeltResourceByteRange } from './range'

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

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.webm': return 'audio/webm'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    default: return 'application/octet-stream'
  }
}

function rangeNotSatisfiableResponse(fileSize: number): Response {
  return new Response(null, {
    status: 416,
    headers: corsHeaders({
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${fileSize}`
    })
  })
}

function partialFileResponse(
  absolutePath: string,
  method: string,
  start: number,
  end: number,
  fileSize: number
): Response {
  const contentLength = end - start + 1
  const headers = corsHeaders({
    'Accept-Ranges': 'bytes',
    'Content-Length': String(contentLength),
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Type': contentTypeFor(absolutePath)
  })
  if (method === 'HEAD') return new Response(null, { status: 206, headers })

  const stream = Readable.toWeb(createReadStream(absolutePath, { start, end })) as ReadableStream<Uint8Array>
  return new Response(stream, { status: 206, headers })
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

  const fileSize = statSync(resolved.absolutePath).size
  const range = parseFeltResourceByteRange(request.headers.get('range'), fileSize)
  if (range === null) return rangeNotSatisfiableResponse(fileSize)
  if (range !== undefined) {
    return partialFileResponse(resolved.absolutePath, method, range.start, range.end, fileSize)
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

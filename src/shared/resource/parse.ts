import { FELT_RESOURCE_KIND_SET, FELT_RESOURCE_PROTOCOL, type FeltResourceKind } from './constants'
import type { ParsedFeltResourceRef } from './types'

const RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function hasPathTraversal(value: string): boolean {
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (/(^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)) return true
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return /(^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)
      decoded = next
    } catch {
      return true
    }
  }
  return /(^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)
}

function normalizeRelativePath(pathname: string): string | undefined {
  const trimmed = pathname.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!trimmed || trimmed.endsWith('/')) return undefined
  if (!RELATIVE_PATH.test(trimmed) || hasPathTraversal(trimmed)) return undefined
  if (trimmed.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return undefined
  return trimmed
}

/**
 * Parse a felt-resource ResourceRef into kind + relative path.
 * Expected form: `felt-resource://material/path/to/file.png`
 */
export function parseFeltResourceRef(value: unknown): ParsedFeltResourceRef | undefined {
  if (typeof value !== 'string' || !value.trim() || /[\\\r\n]/.test(value) || hasPathTraversal(value)) {
    return undefined
  }

  try {
    const url = new URL(value)
    if (url.protocol.toLowerCase() !== FELT_RESOURCE_PROTOCOL) return undefined
    if (url.username || url.password || url.hash || url.search) return undefined

    const kind = url.hostname.toLowerCase()
    if (!FELT_RESOURCE_KIND_SET.has(kind)) return undefined

    const relativePath = normalizeRelativePath(url.pathname)
    if (!relativePath) return undefined

    const ref = `${FELT_RESOURCE_PROTOCOL}//${kind}/${relativePath}`
    return {
      ref,
      kind: kind as FeltResourceKind,
      relativePath
    }
  } catch {
    return undefined
  }
}

export function buildFeltResourceRef(kind: FeltResourceKind, relativePath: string): string | undefined {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized || !FELT_RESOURCE_KIND_SET.has(kind)) return undefined
  return `${FELT_RESOURCE_PROTOCOL}//${kind}/${normalized}`
}

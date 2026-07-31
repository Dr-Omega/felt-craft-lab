import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { toSharedError } from '../contracts/error'
import { parseFeltResourceRef } from './parse'
import type { FeltResourceResolveResult, ResourceRoots } from './types'

function rootForKind(roots: ResourceRoots, kind: 'material' | 'audio' | 'preview'): string {
  if (kind === 'material') return roots.materialRoot
  if (kind === 'audio') return roots.audioRoot
  return roots.previewRoot
}

function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  const rel = relative(resolvedRoot, resolvedCandidate)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

function isInsideRootOrEqual(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  return resolvedRoot === resolvedCandidate || isInsideRoot(resolvedRoot, resolvedCandidate)
}

function invalidRef(message: string): FeltResourceResolveResult {
  return {
    ok: false,
    error: toSharedError(
      {
        code: 'INVALID_ARGUMENT',
        message,
        retryable: false
      },
      'INVALID_ARGUMENT'
    )
  }
}

function notFound(kind: string, relativePath: string): FeltResourceResolveResult {
  return {
    ok: false,
    error: toSharedError(
      {
        code: 'ASSET_NOT_FOUND',
        message: '资源文件不存在或不可用。',
        retryable: false,
        details: { kind, relativePath }
      },
      'ASSET_NOT_FOUND'
    )
  }
}

function safeRealpath(target: string): string | undefined {
  try {
    return realpathSync(target)
  } catch {
    return undefined
  }
}

/**
 * For missing targets, walk to the nearest existing ancestor, realpath it, and
 * rebuild the candidate so junction/symlink parents cannot escape the root.
 */
function resolveMissingCandidate(absolutePath: string, realRoot: string): string | undefined {
  const missingSegments: string[] = []
  let cursor = resolve(absolutePath)

  while (!existsSync(cursor)) {
    missingSegments.unshift(basename(cursor))
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }

  const realAncestor = safeRealpath(cursor)
  if (!realAncestor || !isInsideRootOrEqual(realRoot, realAncestor)) {
    return undefined
  }

  const reconstructed = normalize(join(realAncestor, ...missingSegments))
  if (!isInsideRoot(realRoot, reconstructed)) {
    return undefined
  }
  return reconstructed
}

/**
 * Pure path resolver used by Main and unit tests. Renderer must not call this
 * with filesystem roots; it only consumes ResourceRef / inspect results.
 *
 * Existing targets and missing-target parents are re-checked with realpath so
 * symlinks / Windows junctions cannot escape the kind root.
 */
export function resolveFeltResourcePath(
  ref: string,
  roots: ResourceRoots,
  options: { requireExists?: boolean } = {}
): FeltResourceResolveResult {
  const requireExists = options.requireExists ?? true

  try {
    const parsed = parseFeltResourceRef(ref)
    if (!parsed) {
      return invalidRef('资源引用无效：仅支持 felt-resource://material|audio|preview/... 格式。')
    }

    const segments = parsed.relativePath.split('/')
    const root = rootForKind(roots, parsed.kind)
    const absolutePath = normalize(join(root, ...segments))

    if (!isInsideRoot(root, absolutePath)) {
      return invalidRef('资源引用无效：检测到路径穿越或不安全路径。')
    }

    const realRoot = safeRealpath(root) ?? resolve(root)
    const lexicalUnderRealRoot = normalize(join(realRoot, ...segments))
    if (!isInsideRoot(realRoot, lexicalUnderRealRoot)) {
      return invalidRef('资源引用无效：检测到路径穿越或不安全路径。')
    }

    if (!existsSync(absolutePath)) {
      if (requireExists) return notFound(parsed.kind, parsed.relativePath)

      const safeMissingPath = resolveMissingCandidate(absolutePath, realRoot)
      if (!safeMissingPath) {
        return invalidRef('资源引用无效：检测到路径穿越或不安全路径。')
      }

      return {
        ok: true,
        ref: parsed.ref,
        kind: parsed.kind,
        relativePath: parsed.relativePath,
        absolutePath: safeMissingPath,
        exists: false
      }
    }

    const realCandidate = safeRealpath(absolutePath)
    if (!realCandidate || !isInsideRoot(realRoot, realCandidate)) {
      return invalidRef('资源引用无效：检测到路径穿越或不安全路径。')
    }

    try {
      if (!statSync(realCandidate).isFile()) {
        return notFound(parsed.kind, parsed.relativePath)
      }
    } catch {
      return notFound(parsed.kind, parsed.relativePath)
    }

    return {
      ok: true,
      ref: parsed.ref,
      kind: parsed.kind,
      relativePath: parsed.relativePath,
      absolutePath: realCandidate,
      exists: true
    }
  } catch {
    return {
      ok: false,
      error: toSharedError(
        {
          code: 'UNKNOWN',
          message: '资源解析暂时无法完成，请稍后重试。',
          retryable: true
        },
        'UNKNOWN'
      )
    }
  }
}

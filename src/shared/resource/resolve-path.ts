import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { existsSync, statSync } from 'node:fs'
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

/**
 * Pure path resolver used by Main and unit tests. Renderer must not call this
 * with filesystem roots; it only consumes ResourceRef / inspect results.
 */
export function resolveFeltResourcePath(
  ref: string,
  roots: ResourceRoots,
  options: { requireExists?: boolean } = {}
): FeltResourceResolveResult {
  const requireExists = options.requireExists ?? true
  const parsed = parseFeltResourceRef(ref)
  if (!parsed) {
    return {
      ok: false,
      error: toSharedError(
        {
          code: 'INVALID_ARGUMENT',
          message: '资源引用无效：仅支持 felt-resource://material|audio|preview/... 格式。',
          retryable: false
        },
        'INVALID_ARGUMENT'
      )
    }
  }

  const root = rootForKind(roots, parsed.kind)
  const absolutePath = normalize(join(root, ...parsed.relativePath.split('/')))

  if (!isInsideRoot(root, absolutePath)) {
    return {
      ok: false,
      error: toSharedError(
        {
          code: 'INVALID_ARGUMENT',
          message: '资源引用无效：检测到路径穿越或不安全路径。',
          retryable: false
        },
        'INVALID_ARGUMENT'
      )
    }
  }

  if (requireExists) {
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      return {
        ok: false,
        error: toSharedError(
          {
            code: 'ASSET_NOT_FOUND',
            message: '资源文件不存在或不可用。',
            retryable: false,
            details: { kind: parsed.kind, relativePath: parsed.relativePath }
          },
          'ASSET_NOT_FOUND'
        )
      }
    }
  }

  return {
    ok: true,
    ref: parsed.ref,
    kind: parsed.kind,
    relativePath: parsed.relativePath,
    absolutePath
  }
}

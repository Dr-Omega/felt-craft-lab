import { toSharedError } from '@shared/contracts/error'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceInspectResult, ResourceRoots } from '@shared/resource'

function deny(message: string, code: 'INVALID_ARGUMENT' | 'UNKNOWN' = 'INVALID_ARGUMENT'): ResourceInspectResult {
  return {
    ok: false,
    error: toSharedError(
      { code, message, retryable: code === 'UNKNOWN' },
      code
    )
  }
}

/** Main-side inspect projection; absolute paths are deliberately discarded. */
export function inspectResource(rawRef: unknown, roots: ResourceRoots): ResourceInspectResult {
  try {
    if (typeof rawRef !== 'string') return deny('资源引用必须是字符串。')

    const resolved = resolveFeltResourcePath(rawRef, roots, { requireExists: false })
    if (!resolved.ok) return { ok: false, error: resolved.error }

    return {
      ok: true,
      ref: resolved.ref,
      kind: resolved.kind,
      relativePath: resolved.relativePath,
      exists: resolved.exists
    }
  } catch {
    return deny('资源检查暂时无法完成，请稍后重试。', 'UNKNOWN')
  }
}

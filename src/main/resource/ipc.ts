import { ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { IPC_CHANNELS } from '@shared/constants/app'
import { parseFeltResourceRef } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import { toSharedError } from '@shared/contracts/error'
import type { ResourceInspectResult, ResourceRoots } from '@shared/resource'

export function registerResourceIpc(roots: ResourceRoots): void {
  ipcMain.handle(IPC_CHANNELS.RESOURCE_INSPECT, async (_event, rawRef: unknown): Promise<ResourceInspectResult> => {
    if (typeof rawRef !== 'string') {
      return {
        ok: false,
        error: toSharedError(
          {
            code: 'INVALID_ARGUMENT',
            message: '资源引用必须是字符串。',
            retryable: false
          },
          'INVALID_ARGUMENT'
        )
      }
    }

    const parsed = parseFeltResourceRef(rawRef)
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

    const resolved = resolveFeltResourcePath(parsed.ref, roots, { requireExists: false })
    if (!resolved.ok) {
      return { ok: false, error: resolved.error }
    }

    const exists = existsSync(resolved.absolutePath) && statSync(resolved.absolutePath).isFile()
    return {
      ok: true,
      ref: resolved.ref,
      kind: resolved.kind,
      relativePath: resolved.relativePath,
      exists
    }
  })
}

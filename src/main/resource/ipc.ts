import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import type { ResourceInspectResult, ResourceRoots } from '@shared/resource'
import { isTrustedIpcEvent } from '../security/ipc-guard'

function deny(message: string, code: 'INVALID_ARGUMENT' | 'UNKNOWN' = 'INVALID_ARGUMENT'): ResourceInspectResult {
  return {
    ok: false,
    error: toSharedError(
      {
        code,
        message,
        retryable: code === 'UNKNOWN'
      },
      code
    )
  }
}

export function registerResourceIpc(roots: ResourceRoots): void {
  ipcMain.handle(IPC_CHANNELS.RESOURCE_INSPECT, async (event, rawRef: unknown): Promise<ResourceInspectResult> => {
    try {
      if (!isTrustedIpcEvent(event)) {
        return deny('不受信任的页面不得检查应用资源。')
      }

      if (typeof rawRef !== 'string') {
        return deny('资源引用必须是字符串。')
      }

      const resolved = resolveFeltResourcePath(rawRef, roots, { requireExists: false })
      if (!resolved.ok) {
        return { ok: false, error: resolved.error }
      }

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
  })
}

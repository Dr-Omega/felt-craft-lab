import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import type {
  PersonalAssetPngIngestResult,
  ResourceRoots
} from '@shared/resource'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { ingestPersonalAssetPng } from './personal-ingestion'
import { inspectResource } from './inspect'

function denyIngest(message: string): PersonalAssetPngIngestResult {
  return {
    ok: false,
    error: toSharedError({ code: 'UNKNOWN', message, retryable: false }, 'UNKNOWN')
  }
}

export function registerResourceIpc(roots: ResourceRoots): void {
  ipcMain.handle(IPC_CHANNELS.RESOURCE_INSPECT, async (event, rawRef: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) {
        return {
          ok: false,
          error: toSharedError(
            { code: 'INVALID_ARGUMENT', message: '不受信任的页面不得检查应用资源。', retryable: false },
            'INVALID_ARGUMENT'
          )
        }
      }
      return inspectResource(rawRef, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '资源检查暂时无法完成，请稍后重试。', retryable: true },
          'UNKNOWN'
        )
      }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.PERSONAL_ASSET_RESOURCE_INGEST,
    async (event, rawRequest: unknown): Promise<PersonalAssetPngIngestResult> => {
      try {
        if (!isTrustedIpcEvent(event)) return denyIngest('不受信任的页面不得写入个人素材资源。')
        return ingestPersonalAssetPng(rawRequest, roots)
      } catch {
        return denyIngest('个人素材资源写入暂时无法完成，请稍后重试。')
      }
    }
  )
}

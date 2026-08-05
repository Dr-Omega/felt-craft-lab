import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import type { ResourceRoots } from '@shared/resource'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { deletePreviewPng, savePreviewPng, type PreviewDeleteResult, type PreviewSaveResult } from './write'

function denySave(): PreviewSaveResult {
  return {
    ok: false,
    error: toSharedError(
      { code: 'UNKNOWN', message: '不受信任的页面不得保存预览图。', retryable: false },
      'UNKNOWN'
    )
  }
}

function denyDelete(): PreviewDeleteResult {
  return {
    ok: false,
    error: toSharedError(
      { code: 'UNKNOWN', message: '不受信任的页面不得删除预览图。', retryable: false },
      'UNKNOWN'
    )
  }
}

export function registerPreviewIpc(roots: ResourceRoots): void {
  ipcMain.handle(IPC_CHANNELS.PREVIEW_SAVE, async (event, rawBytes: unknown): Promise<PreviewSaveResult> => {
    try {
      if (!isTrustedIpcEvent(event)) return denySave()
      return savePreviewPng(rawBytes, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'PREVIEW_EXPORT_FAILED', message: '预览图写入暂时无法完成，请稍后重试。', retryable: true },
          'PREVIEW_EXPORT_FAILED'
        )
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PREVIEW_DELETE, async (event, rawRef: unknown): Promise<PreviewDeleteResult> => {
    try {
      if (!isTrustedIpcEvent(event)) return denyDelete()
      return deletePreviewPng(rawRef, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '预览删除暂时无法完成，请稍后重试。', retryable: true },
          'UNKNOWN'
        )
      }
    }
  })
}

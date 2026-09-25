import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import type { ResourceRoots } from '@shared/resource'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import {
  deleteTemporaryStoryCardAudio,
  promoteTemporaryStoryCardAudio,
  readTemporaryStoryCardAudio,
  saveTemporaryStoryCardAudio,
  type TemporaryStoryCardAudioDeleteResult,
  type TemporaryStoryCardAudioPromoteResult,
  type TemporaryStoryCardAudioReadResult,
  type TemporaryStoryCardAudioSaveResult
} from './write'

function denied(): { ok: false; error: ReturnType<typeof toSharedError> } {
  return {
    ok: false,
    error: toSharedError(
      { code: 'UNKNOWN', message: '不受信任的页面不得保存临时录音。', retryable: false },
      'UNKNOWN'
    )
  }
}

export function registerStoryCardAudioIpc(roots: ResourceRoots): void {
  ipcMain.handle(IPC_CHANNELS.STORY_CARD_AUDIO_SAVE, async (event, raw: unknown): Promise<TemporaryStoryCardAudioSaveResult> => {
    try {
      if (!isTrustedIpcEvent(event)) return denied()
      const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      return saveTemporaryStoryCardAudio(input.audioBytes, input.mimeType, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '临时录音写入暂时无法完成，请稍后重试。', retryable: true },
          'UNKNOWN'
        )
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORY_CARD_AUDIO_READ, async (event, rawRef: unknown): Promise<TemporaryStoryCardAudioReadResult> => {
    try {
      if (!isTrustedIpcEvent(event)) return denied()
      return readTemporaryStoryCardAudio(rawRef, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '临时录音读取暂时无法完成，请稍后重试。', retryable: true },
          'UNKNOWN'
        )
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORY_CARD_AUDIO_PROMOTE, async (event, rawRef: unknown): Promise<TemporaryStoryCardAudioPromoteResult> => {
    try {
      if (!isTrustedIpcEvent(event)) return denied()
      return promoteTemporaryStoryCardAudio(rawRef, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '完整录音确认暂时无法完成，请稍后重试。', retryable: true },
          'UNKNOWN'
        )
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORY_CARD_AUDIO_DELETE, async (event, rawRef: unknown): Promise<TemporaryStoryCardAudioDeleteResult> => {
    try {
      if (!isTrustedIpcEvent(event)) return denied()
      return deleteTemporaryStoryCardAudio(rawRef, roots)
    } catch {
      return {
        ok: false,
        error: toSharedError(
          { code: 'UNKNOWN', message: '临时录音删除暂时无法完成，请稍后重试。', retryable: true },
          'UNKNOWN'
        )
      }
    }
  })
}

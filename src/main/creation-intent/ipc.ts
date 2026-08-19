import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/app'
import { toSharedError } from '@shared/contracts/error'
import type { CreationIntentIpcResult } from '@shared/creation-intent'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { CreationIntentHost } from './host'

function deny(): CreationIntentIpcResult {
  return {
    ok: false,
    error: toSharedError(
      { code: 'INVALID_ARGUMENT', message: '不受信任的页面不得发起创作。', retryable: false },
      'INVALID_ARGUMENT'
    )
  }
}

function crash(): CreationIntentIpcResult {
  return {
    ok: false,
    error: toSharedError(
      { code: 'UNKNOWN', message: '创作暂时无法完成，请稍后重试。', retryable: true },
      'UNKNOWN'
    )
  }
}

export function registerCreationIntentIpc(host: CreationIntentHost = new CreationIntentHost()): void {
  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_START, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return host.start(raw)
    } catch {
      return crash()
    }
  })

  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_SUBMIT, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return await host.submit(raw)
    } catch {
      return crash()
    }
  })

  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_CONFIRM, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return await host.confirm(raw)
    } catch {
      return crash()
    }
  })

  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_DECIDE_FOR_ME, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return host.decideForMe(raw)
    } catch {
      return crash()
    }
  })

  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_REGENERATE, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return await host.regenerate(raw)
    } catch {
      return crash()
    }
  })

  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_SNAPSHOT, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return host.snapshot(raw)
    } catch {
      return crash()
    }
  })

  ipcMain.handle(IPC_CHANNELS.CREATION_INTENT_ACCEPT, async (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) return deny()
      return await host.accept(raw)
    } catch {
      return crash()
    }
  })
}

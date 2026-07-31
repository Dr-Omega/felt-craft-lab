import type { IpcMainInvokeEvent } from 'electron'
import { isAllowedRendererUrl } from './renderer-origin'

export function isTrustedIpcEvent(event: IpcMainInvokeEvent): boolean {
  try {
    const frameUrl = event.senderFrame?.url
    if (!frameUrl) return false
    return isAllowedRendererUrl(frameUrl)
  } catch {
    return false
  }
}

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type BootstrapPingResult } from '@shared/constants/app'
import type { ResourceInspectResult } from '@shared/resource'

const electronAPI = {
  ping: (): Promise<BootstrapPingResult> => ipcRenderer.invoke(IPC_CHANNELS.PING),
  /**
   * Renderer-safe resource inspection. Never returns OS paths.
   * Media tags should use the ResourceRef string directly as `felt-resource://...`.
   */
  inspectResource: (ref: string): Promise<ResourceInspectResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.RESOURCE_INSPECT, ref)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type BootstrapPingResult } from '@shared/constants/app'

const electronAPI = {
  ping: (): Promise<BootstrapPingResult> => ipcRenderer.invoke(IPC_CHANNELS.PING)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI

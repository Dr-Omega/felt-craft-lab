import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { FABRICATION_CHANNELS, type ForegroundMode } from '@shared/fabrication-desktop'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { FabricationJobs } from './jobs'

export function registerFabricationIpc(): void {
  const jobs = new FabricationJobs({ root: app.getAppPath(),
    jobsRoot: join(app.getPath('userData'), 'fabrication-jobs'),
    python: process.env.FELT_FABRICATION_PYTHON || '',
    backgroundPython: process.env.FELT_BACKGROUND_PYTHON || '',
    modelCache: process.env.FELT_BIREFNET_CACHE || '' })
  const handlers = {
    [FABRICATION_CHANNELS.start]: (bytes: unknown, mode: ForegroundMode, binding?: unknown) => jobs.start(bytes, mode, binding),
    [FABRICATION_CHANNELS.colors]: (id: string) => jobs.colors(id),
    [FABRICATION_CHANNELS.saveColors]: (id: string, colors: unknown) => jobs.saveColors(id, colors),
    [FABRICATION_CHANNELS.resume]: (id: string) => jobs.resume(id),
    [FABRICATION_CHANNELS.status]: (id: string) => jobs.status(id),
    [FABRICATION_CHANNELS.asset]: (id: string, key: string) => jobs.asset(id, key)
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedIpcEvent(event)) throw new Error('非法调用来源。')
      if (app.isPackaged) throw new Error('该算法集成目前仅用于桌面开发验收，尚未打包发布。')
      return (handler as (...input: unknown[]) => unknown)(...args)
    })
  }
}

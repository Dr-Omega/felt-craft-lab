import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { FABRICATION_CHANNELS, type ForegroundMode } from '@shared/fabrication-desktop'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { FabricationJobs } from './jobs'
import { requireWindowUser } from '../plaza/window-session'
import type { FabricationJob } from '@shared/fabrication-desktop'

export function ownsFabricationJob(job: FabricationJob, userId: string): boolean {
  return (job.ownerUserId ?? job.binding?.scene.userId) === userId && (!job.binding || job.binding.scene.userId === userId)
}

export function registerFabricationIpc(): void {
  const jobs = new FabricationJobs({ root: app.isPackaged
    ? (process.env.FELT_FABRICATION_ROOT || join(process.resourcesPath, 'fabrication-runtime')) : app.getAppPath(),
    requireRuntimeFiles: true,
    jobsRoot: join(app.getPath('userData'), 'fabrication-jobs'),
    python: process.env.FELT_FABRICATION_PYTHON || '',
    backgroundPython: process.env.FELT_BACKGROUND_PYTHON || '',
    modelCache: process.env.FELT_BIREFNET_CACHE || '' })
  let quitting = false
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault(); quitting = true
    void jobs.shutdown().finally(()=>app.quit())
  })
  const handlers = {
    [FABRICATION_CHANNELS.retry]: (id: string) => jobs.retry(id),
    [FABRICATION_CHANNELS.colors]: (id: string) => jobs.colors(id),
    [FABRICATION_CHANNELS.saveColors]: (id: string, colors: unknown) => jobs.saveColors(id, colors),
    [FABRICATION_CHANNELS.resume]: (id: string) => jobs.resume(id),
    [FABRICATION_CHANNELS.status]: (id: string) => jobs.status(id),
    [FABRICATION_CHANNELS.asset]: (id: string, key: string) => jobs.asset(id, key)
  }
  for (const channel of Object.values(FABRICATION_CHANNELS)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedIpcEvent(event)) throw new Error('非法调用来源。')
      const userId = requireWindowUser(event.sender.id)
      if (channel === FABRICATION_CHANNELS.availability) return jobs.availability()
      if (channel === FABRICATION_CHANNELS.list) return (await jobs.list()).filter(job=>ownsFabricationJob(job,userId))
      if (channel === FABRICATION_CHANNELS.start) return jobs.start(args[0], args[1] as ForegroundMode, args[2], userId)
      const job = await jobs.resume(args[0] as string)
      if (requireWindowUser(event.sender.id) !== userId) throw new Error('账号已切换，停止读取任务。')
      if (!ownsFabricationJob(job,userId)) throw new Error('处理任务不属于当前账号；未自动认领旧任务。')
      return (handlers[channel] as (...input: unknown[]) => unknown)(...args)
    })
  }
}

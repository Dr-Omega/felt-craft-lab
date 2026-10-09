import { requireWindowUser } from '../plaza/window-session'
import { ipcMain } from 'electron'
import { LEARNING_CHANNEL } from '@shared/learning'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { LearningHost, learningFailure } from './host'

export function registerLearningIpc(): void {
  const host = new LearningHost()
  const registeredWindows = new Set<number>()
  ipcMain.handle(LEARNING_CHANNEL, (event, raw: unknown) => {
    try {
      if (!isTrustedIpcEvent(event)) throw new Error('不受信任的学习请求。')
      if (!registeredWindows.has(event.sender.id)) {
        const id = event.sender.id
        registeredWindows.add(id)
        event.sender.once('destroyed', () => { host.releaseOwner(String(id)); registeredWindows.delete(id) })
      }
      const input = raw as { path?: unknown; method?: unknown; body?: unknown; snapshotId?: unknown }
      if (!input || typeof input.path !== 'string' || typeof input.snapshotId !== 'string'
        || !/^snapshot_[a-zA-Z0-9_-]+$/.test(input.snapshotId)
        || (input.method !== 'GET' && input.method !== 'POST')
        || (input.body !== undefined && typeof input.body !== 'string')) throw new Error('学习请求格式无效。')
      // Bind guided permissions to the backend-authenticated desktop account.
      const payload = host.request(String(event.sender.id), requireWindowUser(event.sender.id), input.snapshotId, input.path, input.method, input.body)
      return { ok: true, status: 200, payload }
    } catch (error) { return learningFailure(error) }
  })
}

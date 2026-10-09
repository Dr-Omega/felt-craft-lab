import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, stat, realpath } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { WORKSPACE_SYNC_CHANNEL, type SyncRequest, type WorkspaceDocument, type SyncFile } from '@shared/workspace-sync'
import { parseFeltResourceRef, type ResourceRoots } from '@shared/resource'
import { resolveFeltResourcePath } from '@shared/resource/resolve-path'
import { initialColors, validateBinding } from '@shared/fabrication-colors'
import type { FabricationJob, FabricationView } from '@shared/fabrication-desktop'
import { isTrustedIpcEvent } from '../security/ipc-guard'
import { requireWindowUser } from './window-session'
import { gatewayJson } from '../ai/gateway-client'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const CHUNK = 512 * 1024
const UUID = /^[a-f\d-]{36}$/i
const safeName = /^(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function privateResourceRefs(document: WorkspaceDocument): Set<string> {
  const refs = new Set<string>()
  function visit(value: unknown) {
    if (typeof value === 'string' && value.startsWith('felt-resource://')) refs.add(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(document.tables)
  return refs
}

export function registerWorkspaceSync(roots: ResourceRoots): void {
  const running = new Set<number>()
  ipcMain.handle(WORKSPACE_SYNC_CHANNEL, async (event, request: SyncRequest) => {
    if (!isTrustedIpcEvent(event)) throw new Error('非法同步入口。')
    const userId = requireWindowUser(event.sender.id)
    if (running.has(event.sender.id)) throw new Error('同步正在执行。')
    running.add(event.sender.id)
    const stillUser = () => { if (requireWindowUser(event.sender.id) !== userId) throw new Error('账号已切换，停止同步。') }
    async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
      stillUser()
      const response = await gatewayJson(path, { method, plazaUserToken: request.token, isPackaged: app.isPackaged,
        ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      if (!response.ok) throw new Error(response.error.message)
      const data = response.body as { ok: boolean; result?: unknown; error?: { message?: string } }
      if (!data.ok) throw new Error((response.status === 409 ? 'SYNC_CONFLICT: ' : '') + (data.error?.message || '同步请求失败。'))
      stillUser()
      return data.result
    }
    const jobsRoot = join(app.getPath('userData'), 'fabrication-jobs')
    async function filePath(key: string): Promise<string> {
      if (key.startsWith('job/')) {
        const [, id, ...parts] = key.split('/'), name = parts.join('/')
        if (!UUID.test(id) || !safeName.test(name) || name.split('/').some(p=>p==='.'||p==='..') || !/\.(png|svg|json)$/.test(name)) throw new Error('非法同步任务路径。')
        await mkdir(jobsRoot, { recursive: true })
        const root = await realpath(jobsRoot), target = resolve(root, id, name)
        if (!target.startsWith(root + sep)) throw new Error('任务路径越界。')
        // Reuse the resolver's real ancestor/symlink checks for missing destinations.
        const checked = resolveFeltResourcePath('felt-resource://personal/' + id + '/' + name, { ...roots, personalRoot: root }, { requireExists: false })
        if (!checked.ok) throw new Error(checked.error.message)
        return checked.absolutePath
      }
      const parsed = parseFeltResourceRef(key)
      if (!parsed || !['personal', 'preview', 'audio'].includes(parsed.kind) || (parsed.kind === 'audio' && !parsed.relativePath.startsWith('dynamic/'))) throw new Error('只同步用户私有资源。')
      const result = resolveFeltResourcePath(key, roots, { requireExists: false })
      if (!result.ok) throw new Error(result.error.message)
      return result.absolutePath
    }
    async function collect(document: WorkspaceDocument): Promise<Set<string>> {
      if (document.schema !== 'account-workspace/1' || document.userId !== userId) throw new Error('同步用户身份不符。')
      const keys = new Set<string>()
      for (const ref of privateResourceRefs(document)) {
        const parsed = parseFeltResourceRef(ref)
        if (!parsed) throw new Error('资源引用无效。')
        if (parsed.kind === 'personal' || parsed.kind === 'preview' || (parsed.kind === 'audio' && parsed.relativePath.startsWith('dynamic/'))) keys.add(ref)
        else if (!resolveFeltResourcePath(ref, roots, { requireExists: true }).ok) throw new Error('此终端缺少作品使用的素材快照，未替换成新版素材。')
      }
      for (const [versionId, raw] of Object.entries(document.recolor)) {
        const link = raw as { ownerUserId: string; versionId: string; jobId: string; sourceSha256: string }
        if (link.ownerUserId !== userId || link.versionId !== versionId || !UUID.test(link.jobId)) throw new Error('图层归属不匹配。')
        for (const name of ['desktop-job.json', 'view.json', 'scene-binding.json']) keys.add(`job/${link.jobId}/${name}`)
      }
      return keys
    }
    try {
      if (request.action === 'read') {
        const result = await api('/api/workspace')
        if (result.document && result.document.userId !== userId) throw new Error('令牌与当前登录身份不一致。')
        return result
      }
      if (request.action === 'push') {
        const document = structuredClone(request.document!)
        const keys = await collect(document)
        for (const raw of Object.values(document.recolor)) {
          const link = raw as { jobId: string; sourceSha256: string }
          const job = JSON.parse(await readFile(await filePath(`job/${link.jobId}/desktop-job.json`), 'utf8')) as FabricationJob
          if (job.status !== 'complete' || !job.result || job.result.sourceSha256 !== link.sourceSha256) throw new Error('拆分任务尚未完成，不同步不完整产物。')
          const binding = validateBinding(JSON.parse(await readFile(await filePath(`job/${link.jobId}/scene-binding.json`), 'utf8')))
          if ((job.ownerUserId ?? binding?.scene.userId) !== userId || (binding && binding.scene.userId !== userId)) throw new Error('任务用户不匹配。')
          for (const name of Object.values(job.result.assets)) keys.add(`job/${link.jobId}/${name}`)
        }
        const files: SyncFile[] = []
        for (const key of keys) {
          stillUser()
          const path = await filePath(key)
          if ((await stat(path)).size > 30 * 1024 * 1024) throw new Error('单个同步资源超过 30 MiB。')
          const bytes = await readFile(path), chunks: string[] = []
          for (let offset=0; offset<bytes.length; offset+=CHUNK) {
            const part = bytes.subarray(offset,offset+CHUNK), digest=sha(part)
            await api('/api/workspace/chunks/' + digest, 'PUT', { base64: part.toString('base64') }); chunks.push(digest)
          }
          files.push({ key, sha256: sha(bytes), size: bytes.length, chunks })
        }
        document.files = files
        return await api('/api/workspace', 'PUT', { revision: request.revision, document })
      }
      if (request.action !== 'restore') throw new Error('非法同步操作。')
      // Fetch authoritative server snapshot, never write files supplied directly by Renderer.
      const snapshot = await api('/api/workspace') as { revision: number; document: WorkspaceDocument | null }
      if (snapshot.revision !== request.revision || !snapshot.document) throw new Error('SYNC_CONFLICT: 云端已更新，请重新读取。')
      const document = snapshot.document, required = await collect(document)
      const files = new Map(document.files.map(file=>[file.key,file]))
      if (files.size !== document.files.length || [...required].some(k=>!files.has(k))) throw new Error('同步文件清单缺失或重复。')
      const staged = new Map<string, Buffer>()
      let total = 0
      for (const file of files.values()) {
        // Only allow resources declared by the workspace, plus completed-job view assets.
        if (!required.has(file.key) && !file.key.startsWith('job/')) throw new Error('资源不属于本作品快照。')
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 30*1024*1024 || file.chunks.length > 60 || (total += file.size) > 256*1024*1024) throw new Error('同步恢复大小超限。')
        await filePath(file.key)
        const parts: Buffer[] = []
        for (const digest of file.chunks) {
          if (!/^[a-f\d]{64}$/.test(digest)) throw new Error('资源摘要无效。')
          const chunk = await api('/api/workspace/chunks/' + digest)
          const bytes = Buffer.from(chunk.base64, 'base64')
          if (bytes.length>CHUNK || sha(bytes)!==digest) throw new Error('云端资源块损坏。')
          parts.push(bytes)
        }
        const bytes=Buffer.concat(parts)
        if (bytes.length!==file.size || sha(bytes)!==file.sha256) throw new Error('云端文件摘要不匹配。')
        staged.set(file.key, bytes)
      }
      for (const raw of Object.values(document.recolor)) {
        const link = raw as { jobId: string; sourceSha256: string }
        const prefix=`job/${link.jobId}/`
        const job=JSON.parse(staged.get(prefix+'desktop-job.json')!.toString()) as FabricationJob
        const view=JSON.parse(staged.get(prefix+'view.json')!.toString()) as FabricationView
        const binding=validateBinding(JSON.parse(staged.get(prefix+'scene-binding.json')!.toString()))
        if ((job.ownerUserId ?? binding?.scene.userId)!==userId || (binding && binding.scene.userId!==userId) || job.id!==link.jobId || job.status!=='complete' || JSON.stringify(job.result)!==JSON.stringify(view) || view.sourceSha256!==link.sourceSha256 || view.geometryStatus!=='PASS' || view.productionExportEligible!==false) throw new Error('同步拆分产物来源不一致。')
        initialColors(view)
        for(const name of Object.values(view.assets)) { if(!staged.has(prefix+name)) throw new Error('缺少拆分图层资源。'); required.add(prefix+name) }
      }
      if ([...staged.keys()].some(key=>!required.has(key))) throw new Error('包含未引用文件。')
      // Preflight collisions BEFORE writing any file; existing different bytes never overwritten.
      for (const [key, bytes] of staged) {
        const path=await filePath(key)
        try { if(sha(await readFile(path))!==sha(bytes)) throw new Error('本机资源与云端同名不同内容，已停止恢复：'+key) }
        catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e }
      }
      for(const [key,bytes] of staged) {
        stillUser(); const path=await filePath(key); await mkdir(dirname(path),{recursive:true})
        try { await writeFile(path,bytes,{flag:'wx'}) } catch(e) { if((e as NodeJS.ErrnoException).code!=='EEXIST' || sha(await readFile(path))!==sha(bytes)) throw e }
      }
      return snapshot
    } finally { running.delete(event.sender.id) }
  })
}

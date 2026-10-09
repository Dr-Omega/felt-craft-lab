import { reactive } from 'vue'
import { SYNC_TABLES, workspaceFingerprint, type WorkspaceDocument, type SyncTables } from '@shared/workspace-sync'
import { validateDraftRecord, validateProjectRecord, validatePersonalAssetRecord, validatePersonalAssetVersionRecord } from '@shared/contracts/validation'
import { getFeltCraftDatabase } from './db'
import { FELT_RESOURCE_REF_POLICY } from '@shared/resource'
import { loadPlazaSession } from '../services/plaza-session'

export const syncState = reactive({ busy: false, conflict: false, message: '尚未同步', revision: 0 })
let operation: Promise<void> | undefined
let stateUser: string | undefined
const stateKey = (user: string) => 'felt-workspace-sync:' + user
async function digest(document: WorkspaceDocument) {
  const bytes = new TextEncoder().encode(workspaceFingerprint(document))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
export async function captureWorkspace(userId: string): Promise<WorkspaceDocument> {
  const db=getFeltCraftDatabase(), tables={} as SyncTables
  // One consistent read: do not mix a saved project with half-created personal versions.
  await db.transaction('r', SYNC_TABLES.map(name=>db.table(name)), async()=>{
    for (const name of SYNC_TABLES) {
      if(name==='storyCards'||name==='personalAssetVersions') continue
      tables[name]=(await db.table(name).toArray()).filter(row=>(name==='drafts'||name==='projects'?row.scene.userId:row.userId)===userId)
    }
    const assets=new Set(tables.personalAssets.map(row=>row.personalAssetId)), works=new Set(tables.projects.map(row=>row.projectId))
    tables.personalAssetVersions=(await db.personalAssetVersions.toArray()).filter(row=>assets.has(row.personalAssetId)) as unknown as Record<string,unknown>[]
    tables.storyCards=(await db.storyCards.toArray()).filter(row=>works.has(row.workId)) as unknown as Record<string,unknown>[]
  })
  const recolor: Record<string,unknown>={}
  for(const row of tables.personalAssetVersions) {
    const value=localStorage.getItem('felt-recolor-version:'+row.versionId)
    if(value) recolor[String(row.versionId)]=JSON.parse(value)
  }
  return {schema:'account-workspace/1',userId,tables,recolor,files:[]}
}

function validateWorkspace(document: WorkspaceDocument, userId: string) {
  if(document.schema!=='account-workspace/1'||document.userId!==userId) throw new Error('云端账号身份不匹配。')
  for(const name of SYNC_TABLES) if(!Array.isArray(document.tables[name])) throw new Error('云端表结构不完整。')
  for(const row of document.tables.projects) if(!validateProjectRecord(row,FELT_RESOURCE_REF_POLICY).ok || (row.scene as {userId:string}).userId!==userId) throw new Error('云端作品合同校验失败。')
  for(const row of document.tables.drafts) if(!validateDraftRecord(row).ok || (row.scene as {userId:string}).userId!==userId) throw new Error('云端草稿合同校验失败。')
  for(const row of document.tables.personalAssets) if(!validatePersonalAssetRecord(row).ok || row.userId!==userId) throw new Error('云端个人素材校验失败。')
  for(const row of document.tables.personalAssetVersions) if(!validatePersonalAssetVersionRecord(row,FELT_RESOURCE_REF_POLICY).ok) throw new Error('云端素材版本校验失败。')
}

/** Conflict replacement is explicit, backed up locally; no implicit last-write-wins. */
async function restoreWorkspace(document: WorkspaceDocument, local: WorkspaceDocument) {
  const db=getFeltCraftDatabase(), userId=document.userId
  validateWorkspace(document,userId)
  // Links belong to immutable personal versions. Prepare new links before the DB
  // commit; a crash can leave harmless unreferenced links, never missing live ones.
  for(const [id,link] of Object.entries(document.recolor)) {
    const previous=localStorage.getItem('felt-recolor-version:'+id)
    if(previous && workspaceFingerprint({...document,recolor:{[id]:JSON.parse(previous)}}) !== workspaceFingerprint({...document,recolor:{[id]:link}})) throw new Error('相同素材版本的图层关联不同，未覆盖。')
    localStorage.setItem('felt-recolor-version:'+id,JSON.stringify(link))
  }
  await db.transaction('rw',[...SYNC_TABLES.map(name=>db.table(name)),db.table('syncBackups')],async()=>{
    await db.table('syncBackups').add({userId,createdAt:new Date().toISOString(),document:local})
    for(const name of SYNC_TABLES) {
      const table=db.table(name), old=local.tables[name]
      const keys=old.map(row=>table.schema.primKey.compound?(table.schema.primKey.keyPath as string[]).map(k=>row[k]):row[String(table.schema.primKey.keyPath)])
      const ownKeys=new Set(keys.map(key=>JSON.stringify(key)))
      for(const row of document.tables[name]) {
        const key=table.schema.primKey.compound?(table.schema.primKey.keyPath as string[]).map(k=>row[k]):row[String(table.schema.primKey.keyPath)]
        if(!ownKeys.has(JSON.stringify(key)) && await table.get(key as never)) throw new Error('云端记录 ID 与本机其他账号冲突，未覆盖。')
      }
      await table.bulkDelete(keys as never[])
      await table.bulkPut(document.tables[name])
    }
  })
}

export async function syncWorkspace(choice?: 'local'|'remote'): Promise<void> {
  if(operation) return operation
  const session=loadPlazaSession()
  if(!session || !window.electronAPI?.workspaceSync) return
  const userId=session.user.userId, token=session.token
  if(stateUser!==userId){stateUser=userId;syncState.conflict=false;syncState.message='尚未同步'}
  const guard=()=>{if(loadPlazaSession()?.user.userId!==userId)throw new Error('账号已切换，未应用同步结果。')}
  operation=(async()=>{
    syncState.busy=true; syncState.message='同步中……'
    try {
      const local=await captureWorkspace(userId), localHash=await digest(local)
      const raw=localStorage.getItem(stateKey(userId)), base=raw?JSON.parse(raw) as {revision:number;hash:string}:undefined
      const remote=await window.electronAPI.workspaceSync({token,action:'read'})
      guard()
      const hasLocal=SYNC_TABLES.some(name=>local.tables[name].length>0)
      const localDirty=base ? localHash!==base.hash : hasLocal
      const remoteChanged=remote.revision!==(base?.revision ?? 0)
      const remoteHash=remote.document ? await digest(remote.document) : undefined
      if(localHash===remoteHash) {
        localStorage.setItem(stateKey(userId),JSON.stringify({revision:remote.revision,hash:localHash}))
      } else if(remoteChanged && localDirty && !choice) {
        syncState.conflict=true; syncState.message='两端都有修改：本机和云端均已保留，请选择。'; return
      } else if(remote.document && (choice==='remote'||(remoteChanged&&!localDirty))) {
        validateWorkspace(remote.document,userId)
        const restored=await window.electronAPI.workspaceSync({token,action:'restore',revision:remote.revision})
        guard()
        // User edits during download must never be silently replaced.
        if(await digest(await captureWorkspace(userId))!==localHash) throw new Error('SYNC_CONFLICT: 同步期间本机有新修改，未覆盖。')
        await restoreWorkspace(restored.document!,local)
        localStorage.setItem(stateKey(userId),JSON.stringify({revision:restored.revision,hash:await digest(restored.document!)}))
      } else if(localDirty || choice==='local') {
        guard()
        const result=await window.electronAPI.workspaceSync({token,action:'push',revision:remote.revision,document:local})
        guard()
        localStorage.setItem(stateKey(userId),JSON.stringify({revision:result.revision,hash:localHash}))
      }
      syncState.conflict=false; syncState.message='已同步（本机仍保留离线副本）'
      window.dispatchEvent(new Event('felt-workspace-synced'))
    } catch(e) {
      const message=(e as Error).message
      if(message.includes('SYNC_CONFLICT'))syncState.conflict=true
      syncState.message=message+'；本机数据保留，可稍后重试。'
    } finally { syncState.busy=false }
  })().finally(()=>{operation=undefined})
  return operation
}

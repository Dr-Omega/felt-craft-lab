import type { DraftRecord, ProjectRecord } from '@shared/contracts'
import { getFeltCraftDatabase, type FeltCraftDatabase } from './db'
import { DraftStore, ProjectStore } from './stores'
import { blueprintSceneSignature } from './blueprints'

export async function renameWork(
  kind: 'draft' | 'project', id: string, userId: string, rawName: string,
  db: FeltCraftDatabase = getFeltCraftDatabase()
): Promise<DraftRecord | ProjectRecord> {
  const name=rawName.trim()
  if (!name || name.length>80) throw new Error('作品名请填写 1～80 个字。')
  const store=kind==='draft'?new DraftStore(db):new ProjectStore(db)
  const before=await store.get(id)
  if (!userId || !before || before.scene.userId!==userId) throw new Error('作品不存在或不属于当前账号。')
  if (before.scene.workName===name) return before
  const updatedAt=new Date(Math.max(Date.now(),Date.parse(before.updatedAt),Date.parse(before.scene.updatedAt))).toISOString()
  const next={...before,scene:{...before.scene,workName:name,updatedAt},updatedAt}
  if (kind==='project') Object.assign(next,{projectName:name,syncStatus:'local_only'})
  // Only rebind an already-current blueprint: renaming cannot make a stale
  // drawing valid again. Hash outside the IDB transaction to keep it alive.
  const signatures=kind==='project' ? await Promise.all([
    blueprintSceneSignature(before as ProjectRecord),blueprintSceneSignature(next as ProjectRecord)
  ]) : null
  return db.transaction('rw',db.drafts,db.projects,db.blueprints,async()=>{
    const current=await store.get(id)
    if (JSON.stringify(current)!==JSON.stringify(before)) throw new Error('作品已更新，请重新打开后改名。')
    const saved=await store.save(next)
    if (signatures) {
      const artifact=await db.blueprints.get(id)
      if (artifact?.userId===userId && artifact.sceneSignature===signatures[0]) {
        await db.blueprints.put({...artifact,sceneSignature:signatures[1]})
      }
    }
    return saved
  })
}

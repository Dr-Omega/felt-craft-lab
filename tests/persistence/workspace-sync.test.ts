import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFeltCraftDatabase, setFeltCraftDatabaseForTests, type FeltCraftDatabase } from '../../src/renderer/src/persistence/db'
import { captureWorkspace, syncWorkspace, syncState } from '../../src/renderer/src/persistence/workspace-sync'
import { savePlazaSession } from '../../src/renderer/src/services/plaza-session'
import { SYNC_TABLES, type WorkspaceDocument, type SyncRequest } from '../../src/shared/workspace-sync'
import { validFeltProject } from './fixtures'

let db: FeltCraftDatabase, snapshot: {revision:number;document:WorkspaceDocument|null}
let fail=false, duringRestore: (()=>Promise<void>) | undefined
let duringPush: (()=>Promise<void>) | undefined
const user=validFeltProject().scene.userId
const other='other-account'
const calls: string[]=[]
function remoteDocument(name:string): WorkspaceDocument {
  const project=validFeltProject(); project.projectName=name; project.scene.workName=name
  return {schema:'account-workspace/1',userId:user,tables:Object.fromEntries(SYNC_TABLES.map(n=>[n,n==='projects'?[project]:[]])) as unknown as WorkspaceDocument['tables'],recolor:{},files:[]}
}
function withRecolor(document:WorkspaceDocument) {
  const personalAssetId=crypto.randomUUID(), versionId=crypto.randomUUID(), now=new Date().toISOString()
  document.tables.personalAssets=[{personalAssetId,userId:user,role:'element',sourceType:'uploaded',name:'image',currentVersionId:versionId,createdAt:now,updatedAt:now}]
  document.tables.personalAssetVersions=[{versionId,personalAssetId,versionNumber:1,sourceImageRef:`felt-resource://personal/${personalAssetId}/${versionId}/source.png`,parentVersionId:null,createdAt:now}]
  document.recolor={[versionId]:{taskId:'test-task'}}
  return 'felt-recolor-version:'+versionId
}
beforeEach(()=>{
  db=createFeltCraftDatabase('sync-test-'+crypto.randomUUID());setFeltCraftDatabaseForTests(db)
  snapshot={revision:0,document:null}; fail=false; duringRestore=undefined; duringPush=undefined; calls.length=0
  const values=new Map<string,string>()
  vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)})
  vi.stubGlobal('window',{dispatchEvent:vi.fn(),electronAPI:{workspaceSync:async(r:SyncRequest)=>{
    calls.push(r.action);if(fail)throw new Error('network unavailable')
    if(r.action==='push') {if(r.revision!==snapshot.revision)throw new Error('SYNC_CONFLICT');snapshot={revision:snapshot.revision+1,document:structuredClone(r.document!)};await duringPush?.();return {revision:snapshot.revision}}
    if(r.action==='restore')await duringRestore?.()
    return structuredClone(snapshot)
  }}})
  savePlazaSession({token:'test',user:{userId:user,username:'test',role:'child'}})
  syncState.conflict=false
})
afterEach(async()=>{setFeltCraftDatabaseForTests(undefined);await db.delete();vi.unstubAllGlobals()})

it('restores an empty terminal without leaking or deleting another account',async()=>{
  const foreign=validFeltProject({projectId:'22222222-2222-4222-8222-222222222222'});foreign.scene.userId=other
  await db.projects.put(foreign)
  snapshot={revision:1,document:remoteDocument('remote')};await syncWorkspace()
  expect(syncState.message).toContain('已同步')
  expect((await db.projects.get(foreign.projectId))?.scene.userId).toBe(other)
  expect((await captureWorkspace(user)).tables.projects).toHaveLength(1)
  expect(await db.table('syncBackups').count()).toBe(1)
})
it('retains both divergent edits and requires explicit restore with local backup',async()=>{
  await db.projects.put(validFeltProject());await syncWorkspace()
  const local=validFeltProject();local.projectName=local.scene.workName='local edit';await db.projects.put(local)
  snapshot={revision:2,document:remoteDocument('remote edit')};await syncWorkspace()
  expect(syncState.conflict).toBe(true);expect(calls.filter(c=>c==='push')).toHaveLength(1)
  expect((await db.projects.get(local.projectId))?.projectName).toBe('local edit')
  await syncWorkspace('remote')
  expect((await db.projects.get(local.projectId))?.projectName).toBe('remote edit')
  const backup=await db.table('syncBackups').toArray();expect(backup.at(-1).document.tables.projects[0].projectName).toBe('local edit')
})
it('preserves offline saves and retries the original local contents',async()=>{
  await db.projects.put(validFeltProject());fail=true;await syncWorkspace()
  expect(syncState.message).toContain('本机数据保留');expect(await db.projects.count()).toBe(1)
  fail=false;await syncWorkspace();expect(snapshot.document?.tables.projects).toHaveLength(1)
})
it('does not overwrite a local edit made while remote resources download',async()=>{
  snapshot={revision:1,document:remoteDocument('remote')}
  duringRestore=async()=>{await db.projects.put(validFeltProject())}
  await syncWorkspace();expect(syncState.conflict).toBe(true)
  expect((await db.projects.toArray())[0].projectName).not.toBe('remote')
})
it('rejects a remote project ID collision with another local account',async()=>{
  const foreign=validFeltProject();foreign.scene.userId=other;await db.projects.put(foreign)
  const document=remoteDocument('remote'),key=withRecolor(document)
  snapshot={revision:1,document};await syncWorkspace()
  expect(syncState.message).toContain('其他账号冲突')
  expect((await db.projects.toArray())[0].scene.userId).toBe(other)
  expect(await db.table('syncBackups').count()).toBe(0)
  expect(localStorage.getItem(key)).toBeNull()
})
it('does not commit cloud records when link storage fails',async()=>{
  const document=remoteDocument('remote'),key=withRecolor(document)
  const original=localStorage.setItem
  vi.spyOn(localStorage,'setItem').mockImplementation((k,v)=>{if(k===key)throw new Error('storage quota');original(k,v)})
  snapshot={revision:1,document};await syncWorkspace()
  expect(syncState.message).toContain('storage quota')
  expect(await db.projects.count()).toBe(0)
  expect(await db.table('syncBackups').count()).toBe(0)
  expect(localStorage.getItem(key)).toBeNull()
})
it('validates the restore response against the requesting account, not itself',async()=>{
  snapshot={revision:1,document:remoteDocument('remote')}
  duringRestore=async()=>{snapshot.document!.userId=other;snapshot.document!.tables.projects=[]}
  await syncWorkspace()
  expect(syncState.message).toContain('账号身份不匹配')
  expect(await db.table('syncBackups').count()).toBe(0)
  expect(localStorage.getItem('felt-workspace-sync:'+user)).toBeNull()
})
it('rejects a changed restore revision instead of accepting an unreviewed snapshot',async()=>{
  snapshot={revision:1,document:remoteDocument('remote')}
  duringRestore=async()=>{snapshot.revision=2}
  await syncWorkspace()
  expect(syncState.conflict).toBe(true)
  expect(await db.projects.count()).toBe(0)
})
it.each(['assetAccess','favorites','learningProgress'] as const)('rejects foreign account rows in %s',async table=>{
  const document=remoteDocument('remote');document.tables[table]=[{userId:other,assetId:'foreign'}]
  snapshot={revision:1,document};await syncWorkspace()
  expect(syncState.message).toContain('账号身份不匹配')
  expect(await db.projects.count()).toBe(0)
})
it('rejects orphan story cards and recolor links before restoring any records',async()=>{
  const document=remoteDocument('remote');document.tables.storyCards=[{workId:'foreign-work'}]
  snapshot={revision:1,document};await syncWorkspace()
  expect(syncState.message).toContain('关联记录')
  document.tables.storyCards=[];document.recolor={'foreign-version':{taskId:'foreign'}}
  await syncWorkspace()
  expect(syncState.message).toContain('所属素材版本')
  expect(localStorage.getItem('felt-recolor-version:foreign-version')).toBeNull()
  expect(await db.projects.count()).toBe(0)
})
it('reports edits made during upload as pending, then uploads them on retry',async()=>{
  await db.projects.put(validFeltProject())
  duringPush=async()=>{const edit=validFeltProject();edit.projectName=edit.scene.workName='new edit';await db.projects.put(edit)}
  await syncWorkspace()
  expect(syncState.message).toContain('新修改待同步')
  expect(syncState.revision).toBe(1)
  expect(snapshot.document!.tables.projects[0].projectName).not.toBe('new edit')
  duringPush=undefined;await syncWorkspace()
  expect(syncState.message).toContain('已同步')
  expect(snapshot.document!.tables.projects[0].projectName).toBe('new edit')
})
it('does not apply a response after the account session is replaced',async()=>{
  snapshot={revision:1,document:remoteDocument('remote')}
  duringRestore=async()=>{savePlazaSession({token:'new-session',user:{userId:user,username:'test',role:'child'}})}
  await syncWorkspace()
  expect(syncState.message).toContain('账号已切换')
  expect(await db.projects.count()).toBe(0)
})

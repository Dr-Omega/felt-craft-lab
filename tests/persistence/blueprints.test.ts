import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlueprintStore, blueprintSceneSignature } from '../../src/renderer/src/persistence/blueprints'
import { createFeltCraftDatabase, deleteExistingProject, ProjectStore, type FeltCraftDatabase } from '../../src/renderer/src/persistence'
import { defaultSubjectSizeChoice } from '../../src/renderer/src/projection/subject-size'
import { MINIMAL_PNG_BYTES, validFeltProject } from './fixtures'
const artifact=()=>({pdf:new Blob(['%PDF-test'],{type:'application/pdf'}),thumbnail:'data:image/png;base64,'+Buffer.from(MINIMAL_PNG_BYTES).toString('base64'),
  backgroundMode:'image' as const,size:defaultSubjectSizeChoice()})
let db:FeltCraftDatabase
beforeEach(()=>{db=createFeltCraftDatabase('blueprint-test-'+crypto.randomUUID())})
afterEach(async()=>{vi.unstubAllGlobals();await db.delete()})

describe('real local blueprint artifacts',()=>{
  it('stores the PDF and first sheet for the exact saved scene, and survives reopening',async()=>{
    const work=validFeltProject(),store=new BlueprintStore(db)
    await new ProjectStore(db).save(work)
    await store.save(work,artifact())
    db.close();await db.open()
    const saved=await store.getForWork(work)
    expect(saved?.thumbnail).toBe(artifact().thumbnail);expect(saved?.backgroundMode).toBe('image')
    expect(await saved!.pdf.text()).toBe('%PDF-test')
    expect(saved?.printRevision).toBe('safe-a4-black-03mm-v1')
    expect(await store.listForWorks(work.scene.userId,[work])).toHaveLength(1)
  })
  it('does not invent export history for existing drawings, and keeps one latest artifact per work',async()=>{
    const work=validFeltProject(),store=new BlueprintStore(db)
    await new ProjectStore(db).save(work)
    expect(await store.listForWorks(work.scene.userId,[work])).toEqual([])
    await store.save(work,artifact());await store.save(work,{...artifact(),backgroundMode:'layers'})
    expect(await db.blueprints.count()).toBe(1)
    expect((await store.getForWork(work))?.backgroundMode).toBe('layers')
  })
  it('does not show other accounts, deleted works or stale artwork as current blueprints',async()=>{
    const work=validFeltProject(),store=new BlueprintStore(db)
    await new ProjectStore(db).save(work);await store.save(work,artifact())
    expect(await store.listForWorks('other',[work])).toEqual([])
    expect(await store.listForWorks(work.scene.userId,[])).toEqual([])
    const changed=structuredClone(work);changed.scene.objects[0].left+=1
    expect(await store.getForWork(changed)).toBeUndefined()
    expect(await store.listForWorks(work.scene.userId,[changed])).toEqual([])
    expect(await store.getForWork({...work,scene:{...work.scene,userId:'other'}})).toBeUndefined()
  })
  it('rejects races, ownership mismatches, invalid data and deleted projects before saving',async()=>{
    const work=validFeltProject(),store=new BlueprintStore(db)
    await expect(store.save(work,artifact())).rejects.toThrow('作品已更新或不存在')
    await new ProjectStore(db).save(work)
    const other=structuredClone(work);other.scene.userId='other'
    await expect(store.save(other,artifact())).rejects.toThrow('作品已更新或不存在')
    const stale=structuredClone(work);stale.scene.objects[0].left+=1
    await expect(store.save(stale,artifact())).rejects.toThrow('作品已更新或不存在')
    await expect(store.save(work,{...artifact(),thumbnail:'artwork-placeholder'})).rejects.toThrow('缩略图无效')
    expect(await db.blueprints.count()).toBe(0)
  })
  it('uses canonical scene keys but preserves meaningful array order and color',async()=>{
    const work=validFeltProject(),reordered=structuredClone(work)
    reordered.scene=Object.fromEntries(Object.entries(reordered.scene).reverse()) as typeof work.scene
    expect(await blueprintSceneSignature(reordered)).toBe(await blueprintSceneSignature(work))
    reordered.scene.canvas.backgroundColor='#FF0000'
    expect(await blueprintSceneSignature(reordered)).not.toBe(await blueprintSceneSignature(work))
  })
  it('deletes the blueprint atomically with its project and story',async()=>{
    const work=validFeltProject()
    await new ProjectStore(db).save(work);await new BlueprintStore(db).save(work,artifact())
    vi.stubGlobal('window',{electronAPI:{deleteProjectPreview:vi.fn(async()=>{})}})
    await deleteExistingProject(work.projectId,{db})
    expect(await db.blueprints.count()).toBe(0);expect(await db.projects.count()).toBe(0)
  })
  it('adds the v6 artifact table without dropping v5 work, story or sync backup records',async()=>{
    const name='blueprint-upgrade-'+crypto.randomUUID(),old=new Dexie(name)
    old.version(5).stores({projects:'projectId,updatedAt,projectName',storyCards:'workId,confirmedAt',syncBackups:'++id,userId,createdAt'})
    await old.open()
    const work=validFeltProject()
    await old.table('projects').put(work);await old.table('storyCards').put({workId:work.projectId,confirmedAt:work.updatedAt})
    await old.table('syncBackups').add({userId:work.scene.userId,createdAt:work.updatedAt,document:{test:true}})
    old.close()
    const upgraded=createFeltCraftDatabase(name)
    try{
      await upgraded.open()
      expect(await upgraded.projects.get(work.projectId)).toEqual(work)
      expect(await upgraded.storyCards.count()).toBe(1);expect(await upgraded.table('syncBackups').count()).toBe(1)
      expect(await upgraded.blueprints.count()).toBe(0)
    }finally{await upgraded.delete()}
  })
})

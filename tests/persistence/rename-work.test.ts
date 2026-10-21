import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeltCraftDatabase, DraftStore, ProjectStore, type FeltCraftDatabase } from '../../src/renderer/src/persistence'
import { BlueprintStore } from '../../src/renderer/src/persistence/blueprints'
import { renameWork } from '../../src/renderer/src/persistence/rename-work'
import { defaultSubjectSizeChoice } from '../../src/renderer/src/projection/subject-size'
import { validFeltDraft, validFeltProject } from './fixtures'
let db:FeltCraftDatabase
beforeEach(()=>{db=createFeltCraftDatabase('rename-'+crypto.randomUUID())})
afterEach(async()=>{vi.restoreAllMocks();await db.delete()})
const artifact=()=>({pdf:new Blob(['%PDF-original'],{type:'application/pdf'}),thumbnail:'data:image/png;base64,AA==',backgroundMode:'layers' as const,size:defaultSubjectSizeChoice()})

describe('local work rename',()=>{
  it('updates both project names, preserves art/story/identity, and survives reopening',async()=>{
    const work=validFeltProject();await new ProjectStore(db).save(work)
    const story={workId:work.projectId,title:'独立的故事标题',storyText:'故事不变',confirmedAt:work.updatedAt}
    await db.storyCards.put(story as never)
    await renameWork('project',work.projectId,work.scene.userId,'  春节的小院  ',db)
    db.close();await db.open()
    const saved=(await new ProjectStore(db).get(work.projectId))!
    expect(saved.projectName).toBe('春节的小院');expect(saved.scene.workName).toBe('春节的小院')
    expect(saved.previewUrl).toBe(work.previewUrl);expect(saved.projectId).toBe(work.projectId)
    expect(saved.scene).toEqual({...work.scene,workName:'春节的小院',updatedAt:saved.scene.updatedAt})
    expect(saved.updatedAt).toBe(saved.scene.updatedAt);expect(saved.createdAt).toBe(work.createdAt)
    expect(await db.storyCards.get(work.projectId)).toEqual(story)
  })
  it('supports draft names without converting them to saved works',async()=>{
    const draft=validFeltDraft();await new DraftStore(db).save(draft)
    await renameWork('draft',draft.draftId,draft.scene.userId,'新的草稿名',db)
    const saved=await new DraftStore(db).get(draft.draftId)
    expect(saved?.scene.workName).toBe('新的草稿名');expect(saved?.status).toBe('draft')
    expect(await db.projects.count()).toBe(0)
  })
  it('retains current PDF and thumbnail, but never revives stale blueprints',async()=>{
    const work=validFeltProject();await new ProjectStore(db).save(work)
    const store=new BlueprintStore(db);await store.save(work,artifact())
    await renameWork('project',work.projectId,work.scene.userId,'新作品名',db)
    let saved=(await new ProjectStore(db).get(work.projectId))!
    const paper=(await store.getForWork(saved))!
    expect(await paper.pdf.text()).toBe('%PDF-original');expect(paper.thumbnail).toBe(artifact().thumbnail)
    await db.blueprints.put({...paper,sceneSignature:'stale'})
    await renameWork('project',work.projectId,work.scene.userId,'再次改名',db)
    saved=(await new ProjectStore(db).get(work.projectId))!
    expect(await store.getForWork(saved)).toBeUndefined()
    expect((await db.blueprints.get(work.projectId))?.sceneSignature).toBe('stale')
  })
  it('rejects blank/oversize names, foreign owners and missing records without changing data',async()=>{
    const work=validFeltProject();await new ProjectStore(db).save(work)
    for(const name of ['  ','字'.repeat(81)]) await expect(renameWork('project',work.projectId,work.scene.userId,name,db)).rejects.toThrow('1～80')
    for(const owner of ['other','']) await expect(renameWork('project',work.projectId,owner,'新名',db)).rejects.toThrow('不属于')
    await expect(renameWork('project','missing',work.scene.userId,'新名',db)).rejects.toThrow('不存在')
    expect(await new ProjectStore(db).get(work.projectId)).toEqual(work)
    await renameWork('project',work.projectId,work.scene.userId,work.projectName,db)
    expect(await new ProjectStore(db).get(work.projectId)).toEqual(work)
  })
  it('rolls back project and blueprint together on write failure',async()=>{
    const work=validFeltProject();await new ProjectStore(db).save(work)
    const paper=await new BlueprintStore(db).save(work,artifact())
    db.blueprints.hook('updating',()=>{throw new Error('disk failure')})
    await expect(renameWork('project',work.projectId,work.scene.userId,'新名',db)).rejects.toThrow('disk failure')
    expect(await new ProjectStore(db).get(work.projectId)).toEqual(work)
    expect((await db.blueprints.get(work.projectId))?.sceneSignature).toBe(paper.sceneSignature)
  })
  it('refuses to overwrite concurrent artwork edits made while preparing the rename',async()=>{
    const work=validFeltProject();await new ProjectStore(db).save(work)
    const original=ProjectStore.prototype.get;let reads=0
    vi.spyOn(ProjectStore.prototype,'get').mockImplementation(async function(this:ProjectStore,id:string){
      const record=await original.call(this,id)
      if(++reads===1) await db.projects.update(id,{scene:{...work.scene,canvas:{...work.scene.canvas,backgroundColor:'#FF0000'}}})
      return record
    })
    await expect(renameWork('project',work.projectId,work.scene.userId,'新名',db)).rejects.toThrow('作品已更新')
    const saved=await db.projects.get(work.projectId)
    expect(saved?.projectName).toBe(work.projectName);expect(saved?.scene.canvas.backgroundColor).toBe('#FF0000')
  })
})

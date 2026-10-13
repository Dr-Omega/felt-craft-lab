import { describe, it, expect, vi } from 'vitest'
import { readPersonalElementInput } from '../../src/renderer/src/fabrication/element-input'
import { validScene } from '../shared/contracts.fixtures'
import type { PersonalAssetRecord, PersonalAssetVersionRecord } from '../../src/shared/contracts'
import { sameElementSource } from '../../src/shared/fabrication-task-identity'

const assetId='8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1', versionId='3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const objectId='2a8c8c2b-66ef-43b5-9ea4-748af0eac3b4'
const scene={...validScene,personalElements:[{objectId,personalAssetId:assetId,versionId,left:100,top:100,scaleX:1,scaleY:1,angle:0,visible:true,locked:false,zIndex:2}]}
const asset:PersonalAssetRecord={personalAssetId:assetId,currentVersionId:'8d4bbd2b-7288-4a19-b0dd-5bf43fd1cb9e',userId:scene.userId,name:'original',role:'element',sourceType:'uploaded',createdAt:scene.createdAt,updatedAt:scene.updatedAt}
const version:PersonalAssetVersionRecord={personalAssetId:assetId,versionId,versionNumber:1,parentVersionId:null,createdAt:scene.createdAt,sourceImageRef:`felt-resource://personal/${assetId}/${versionId}/source.jpg`}
const bytes=new Uint8Array([255,216,255,224,1,2,3,255,217])
const read=vi.fn(async()=>new Response(bytes))

describe('algorithm input is a pinned source, not presentation pixels',()=>{
  it('is byte-identical after placement, scaling, rotation, scene save/reopen and unrelated changes',async()=>{
    const resolve=vi.fn(async()=>({asset,version}))
    for (const changed of [scene, {...scene,updatedAt:'2026-10-12T09:00:00.000Z',personalElements:[{...scene.personalElements[0],left:473,top:812,scaleX:.2,scaleY:3,angle:87}]}, JSON.parse(JSON.stringify(scene))]) {
      expect(await readPersonalElementInput(changed,objectId,resolve,read)).toEqual(bytes)
      expect(resolve).toHaveBeenLastCalledWith(assetId,versionId)
      expect(read).toHaveBeenLastCalledWith(version.sourceImageRef)
    }
  })
  it('uses an intentionally changed fixed version, not an asset latest pointer',async()=>{
    const id=asset.currentVersionId, next={...version,versionId:id,sourceImageRef:`felt-resource://personal/${assetId}/${id}/source.jpg`}
    const resolve=vi.fn(async()=>({asset,version:next}))
    await readPersonalElementInput({...scene,personalElements:[{...scene.personalElements[0],versionId:id}]},objectId,resolve,read)
    expect(resolve).toHaveBeenCalledWith(assetId,id)
    expect(sameElementSource({scene,objectId},{scene:{...scene,personalElements:[{...scene.personalElements[0],versionId:id}]},objectId})).toBe(false)
  })
  it('fails closed for missing, wrong-owner, wrong-version and corrupt sources',async()=>{
    for(const bundle of [{asset:{...asset,userId:'other'},version},{asset,version:{...version,versionId:asset.currentVersionId}},
      {asset,version:{...version,sourceImageRef:'https://example.com/image.jpg'}}]) {
      await expect(readPersonalElementInput(scene,objectId,async()=>bundle,read)).rejects.toThrow('不匹配')
    }
    await expect(readPersonalElementInput(scene,objectId,async()=>{throw Error('missing')},read)).rejects.toThrow('missing')
    await expect(readPersonalElementInput(scene,objectId,async()=>({asset,version}),async()=>new Response(null,{status:404}))).rejects.toThrow('未使用画布预览替代')
    await expect(readPersonalElementInput(scene,objectId,async()=>({asset,version}),async()=>new Response('bad'))).rejects.toThrow('PNG 或 JPEG')
  })
  it('only allows catalog fallback for a visible existing catalog element',async()=>{
    const resolve=vi.fn(async()=>({asset,version}))
    await expect(readPersonalElementInput(validScene,validScene.objects[0].objectId,resolve,read)).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
    await expect(readPersonalElementInput(scene,'missing',resolve,read)).rejects.toThrow('不可用')
  })
})

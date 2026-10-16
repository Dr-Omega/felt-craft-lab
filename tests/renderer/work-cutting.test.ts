import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { FabricationJob, FabricationView } from '../../src/shared/fabrication-desktop'
import { validProject } from '../shared/contracts.fixtures'
import { prepareWorkCuts } from '../../src/renderer/src/workflows/work-cutting'

const mocks = vi.hoisted(()=>({link:vi.fn(),resolve:vi.fn()}))
vi.mock('../../src/renderer/src/catalog/ywn-catalog',()=>({createCatalogResolver:()=>({resolveAsset:mocks.resolve})}))
vi.mock('../../src/renderer/src/fabrication/canvas-recolor',()=>({readCanvasRecolorLink:mocks.link}))
vi.mock('../../src/renderer/src/workflows/work-display',()=>({displayObjectOrder:(scene:typeof validProject.scene)=>[...scene.objects,...scene.personalElements]}))

const bytes=new Uint8Array([137,80,78,71,13,10,26,10]),sourceSha256=createHash('sha256').update(bytes).digest('hex')
const view:FabricationView={schemaVersion:'desktop-fabrication-view/1',resultSha256:'a'.repeat(64),sourceSha256,width:100,height:100,pieceCount:1,stepCount:1,materialDepth:1,steps:[{step:1,colorSlotId:'red',rgb:[255,0,0],pieceIds:['p'],pieceNumbers:[1],asset:'step-1'}],assets:{},geometryStatus:'PASS',visualAcceptance:'PENDING',manufacturing:'NOT_EVALUATED',productionExportEligible:false}
const work=structuredClone(validProject),binding={scene:work.scene,objectId:work.scene.objects[0].objectId}
const job:FabricationJob={id:'fixture',status:'complete',message:'',startedAt:0,ownerUserId:work.scene.userId,binding,result:view}
const geometry={resultSha256:view.resultSha256,sourceSha256,width:100,height:100,pieces:[{id:'p',step:1,color:'#FF0000',polygons:[[[[0,0],[100,0],[100,100],[0,100],[0,0]]]]}]}
let api:{list:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;cuttingGeometry:ReturnType<typeof vi.fn>;colors:ReturnType<typeof vi.fn>}
beforeEach(()=>{
  mocks.link.mockReset();mocks.resolve.mockResolvedValue({imageUrl:'felt-resource://material/pinned.png'})
  api={list:vi.fn(async()=>[job]),start:vi.fn(async()=>{throw Error('NEW_INPUT_REQUIRES_PROCESSING')}),cuttingGeometry:vi.fn(async()=>geometry),colors:vi.fn()}
  vi.stubGlobal('window',{electronAPI:{fabrication:api}})
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)))
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1,height:1,close:vi.fn()})))
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray([0,0,0,0])})})})})
})
afterEach(()=>vi.unstubAllGlobals())
describe('saved-work cutting input provenance',()=>{
  it('reuses only the exact pinned source and leaves unrelated latest task colors out of an unrecolored work',async()=>{
    const cuts=await prepareWorkCuts(work,vi.fn(),new AbortController().signal)
    expect(api.start).not.toHaveBeenCalled();expect(api.colors).not.toHaveBeenCalled()
    expect(api.cuttingGeometry).toHaveBeenCalledWith(job.id);expect(cuts[0].color).toBe('#FF0000')
  })
  it('rejects missing or mismatched existing layers without running the unapproved algorithm',async()=>{
    for(const altered of [{...job,result:{...view,sourceSha256:'b'.repeat(64)}},{...job,binding:{scene:{...work.scene,assetSnapshotId:'different-snapshot'},objectId:binding.objectId}}]){
      api.list.mockResolvedValue([altered])
      await expect(prepareWorkCuts(work,vi.fn(),new AbortController().signal)).rejects.toThrow('不会自动运行拆分算法')
      expect(api.cuttingGeometry).not.toHaveBeenCalled()
    }
    expect(api.start).not.toHaveBeenCalled()
  })
  it('rejects geometry from a different canonical result and stops when navigation cancels preparation',async()=>{
    api.cuttingGeometry.mockResolvedValue({...geometry,resultSha256:'other'})
    await expect(prepareWorkCuts(work,vi.fn(),new AbortController().signal)).rejects.toThrow('颜色版本不匹配')
    const controller=new AbortController();controller.abort();api.list.mockClear()
    await expect(prepareWorkCuts(work,vi.fn(),controller.signal)).rejects.toThrow('已取消')
    expect(api.list).not.toHaveBeenCalled()
  })
})

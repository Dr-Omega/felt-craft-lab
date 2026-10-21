import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { validProject } from '../shared/contracts.fixtures'
import { providedPsdPack } from '../../src/renderer/src/projection/provided-psd-artwork'
import { prepareBackgroundCuts } from '../../src/renderer/src/workflows/work-background-cutting'

const mocks=vi.hoisted(()=>({resolve:vi.fn(),paint:vi.fn(),draw:vi.fn()}))
vi.mock('../../src/renderer/src/catalog/ywn-catalog',()=>({createCatalogResolver:()=>({resolveAsset:mocks.resolve})}))
vi.mock('../../src/renderer/src/projection/provided-psd-artwork',async importOriginal=>({
  ...await importOriginal<typeof import('../../src/renderer/src/projection/provided-psd-artwork')>(),paintProvidedPsd:mocks.paint
}))
vi.mock('../../src/renderer/src/projection/psd-mask-contours',()=>({psdMaskContours:()=>[[[[0,0],[10,0],[10,10],[0,10],[0,0]]]]}))
beforeEach(()=>{
  mocks.resolve.mockReset();mocks.paint.mockReset();mocks.draw.mockReset()
  vi.stubGlobal('Image',class {src='';async decode(){}})
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({clearRect:vi.fn(),drawImage:mocks.draw,getImageData:()=>({data:new Uint8ClampedArray()})})})})
})
afterEach(()=>vi.unstubAllGlobals())
function work(){const w=structuredClone(validProject);w.scene.canvas={width:1302,height:858,backgroundColor:'#FFF8E7'};w.scene.personalBackground=null;return w}
it('reads all eight authored background layers despite the old catalog lacking a preSplitDataUrl',async()=>{
  const pack=providedPsdPack('beijing'),w=work()
  mocks.resolve.mockResolvedValue({imageUrl:pack.imageUrl})
  mocks.paint.mockResolvedValue({layers:pack.layers.map(l=>l.imageUrl)})
  const cuts=await prepareBackgroundCuts(w,'layers',new AbortController().signal)
  expect(cuts).toHaveLength(8)
  expect(cuts.map(c=>c.step)).toEqual([1,2,3,4,5,6,7,8])
  expect(cuts.map(c=>c.color)).toEqual(pack.layers.map(l=>l.dominantColor))
  expect(cuts.every(c=>c.element===1&&!c.imageUrl&&c.backgroundFrame?.width===1302)).toBe(true)
  expect(mocks.draw).toHaveBeenCalledTimes(8)
})
it('prints one intact image when not splitting, without looking up PSD geometry',async()=>{
  const cuts=await prepareBackgroundCuts(work(),'image',new AbortController().signal,'data:image/png;base64,verified-preview')
  expect(cuts).toHaveLength(1);expect(cuts[0].imageUrl).toContain('verified-preview')
  expect(cuts[0].backgroundFrame).toEqual({width:1302,height:858})
  expect(mocks.resolve).not.toHaveBeenCalled();expect(mocks.paint).not.toHaveBeenCalled()
})
it('does not export UI paper as an image or as a layer',async()=>{
  const w=work();w.scene.backgroundAssetId=null
  for(const mode of ['layers','image'] as const)expect(await prepareBackgroundCuts(w,mode,new AbortController().signal)).toEqual([])
  expect(mocks.resolve).not.toHaveBeenCalled()
})
it('does not substitute new background masks into a different pinned snapshot',async()=>{
  mocks.resolve.mockResolvedValue({imageUrl:'felt-resource://material/older-snapshot/background.png'})
  await expect(prepareBackgroundCuts(work(),'layers',new AbortController().signal)).rejects.toThrow('没有现成的 PSD 图层')
  expect(mocks.paint).not.toHaveBeenCalled()
})
it('cancels before reading background resources',async()=>{
  const controller=new AbortController();controller.abort()
  await expect(prepareBackgroundCuts(work(),'layers',controller.signal)).rejects.toThrow('已取消')
  expect(mocks.resolve).not.toHaveBeenCalled()
})

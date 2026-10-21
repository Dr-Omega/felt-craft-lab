import { afterEach, expect, it, vi } from 'vitest'
import { cuttingPageThumbnail } from '../../src/renderer/src/projection/cutting-thumbnail'
import { planCuttingPages, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'
afterEach(()=>vi.unstubAllGlobals())
it('draws actual first-page cuts with holes, original colors, page size and only their shared labels',async()=>{
  const context={scale:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),lineTo:vi.fn(),moveTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),stroke:vi.fn(),fillText:vi.fn(),
    fillStyle:'',strokeStyle:'',lineWidth:0,font:'',textBaseline:''}
  const canvas={width:0,height:0,getContext:()=>context,toDataURL:vi.fn(()=> 'data:image/png;base64,thumbnail')}
  vi.stubGlobal('document',{createElement:()=>canvas})
  const piece:CutPiece={id:'p',element:2,step:3,color:'#3575CF',rings:[[[0,0],[100,0],[100,50],[0,50]],[[10,10],[20,10],[20,20],[10,20]]]}
  const plan=planCuttingPages([piece],{mode:'specific',targetLongEdgeMm:180,label:'test'})
  expect(await cuttingPageThumbnail(plan.pages[0])).toBe('data:image/png;base64,thumbnail')
  expect(canvas.width).toBe(525);expect(canvas.height).toBe(743)
  expect(context.moveTo).toHaveBeenCalledTimes(2);expect(context.fill).toHaveBeenCalledWith('evenodd')
  expect(context.strokeStyle).toBe('#000000');expect(context.lineWidth).toBe(.3)
  expect(context.fillText).toHaveBeenCalledWith('2-3',plan.pages[0].labels[0].x,plan.pages[0].labels[0].y)
  expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
})

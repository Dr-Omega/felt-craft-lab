import { beforeEach, expect, it, vi } from 'vitest'
import { exportCuttingPdf } from '../../src/renderer/src/projection/cutting-pdf'
import { planCuttingPages, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'
import { buildAssemblyGuide } from '../../src/renderer/src/projection/assembly-guide'
import type { WorkDisplay } from '../../src/renderer/src/workflows/work-display'

const doc=vi.hoisted(()=>({addPage:vi.fn(),addImage:vi.fn(),setFillColor:vi.fn(),setDrawColor:vi.fn(),setLineWidth:vi.fn(),
  setFontSize:vi.fn(),setTextColor:vi.fn(),text:vi.fn(),lines:vi.fn(),fillStrokeEvenOdd:vi.fn(),line:vi.fn(),
  saveGraphicsState:vi.fn(),restoreGraphicsState:vi.fn(),rect:vi.fn(),clip:vi.fn(),discardPath:vi.fn(),
  viewerPreferences:vi.fn(),output:vi.fn(()=>new Blob(['pdf']))}))
vi.mock('jspdf',()=>({jsPDF:class{constructor(){return doc}}}))
vi.mock('../../src/renderer/src/projection/pdf-text-image',()=>({ensurePdfTextFont:async()=>{},
  rasterizePdfText:(text:string)=>({dataUrl:`title:${text}`,widthMm:30,heightMm:5})}))
const rect=(id:string,element:number,step:number):CutPiece=>({id,element,step,color:'#FFFFFF',rings:[[[10,20],[110,20],[110,70],[10,70]]]})
beforeEach(()=>vi.clearAllMocks())
it('appends cumulative element guides after cuts, then a new page of complete scene placement steps',async()=>{
  const cuts=[rect('a',1,1),{...rect('b',1,2),color:'#3575CF'},rect('c',2,1)]
  const display:WorkDisplay={width:200,height:100,layers:[{id:'a',label:'灯笼',background:false,image:'l'},
    {id:'b',label:'福娃',background:false,image:'f'}],assemblies:['scene1','scene2']}
  const plan=planCuttingPages(cuts,{mode:'specific',targetLongEdgeMm:50,label:'test'})
  await exportCuttingPdf(plan,'作品',buildAssemblyGuide(cuts,display))
  expect(doc.text.mock.calls.map(c=>c[0])).toEqual(['1-1','1-2','2-1','+ 1-1','+ 1-2','+ 2-1','+ 1','+ 2'])
  expect(doc.addPage).toHaveBeenCalledTimes(2)
  expect(doc.addImage.mock.calls.map(c=>c[0])).toEqual(['title:1 · 灯笼','title:2 · 福娃','title:整体叠放','scene1','scene2'])
  const firstGuidePage=doc.addPage.mock.invocationCallOrder[0]
  expect(doc.text.mock.invocationCallOrder[2]).toBeLessThan(firstGuidePage)
  expect(doc.text.mock.invocationCallOrder[3]).toBeGreaterThan(firstGuidePage)
  expect(doc.addImage.mock.invocationCallOrder.at(-1)).toBeLessThan(doc.output.mock.invocationCallOrder[0])
})
it('continues long making sequences without missing steps and keeps instructions on A4',async()=>{
  const cuts=Array.from({length:18},(_,i)=>rect(String(i),1,i+1))
  const display:WorkDisplay={width:200,height:100,layers:[{id:'a',label:'元素',background:false,image:'x'}],assemblies:['final']}
  const plan=planCuttingPages(cuts,{mode:'specific',targetLongEdgeMm:10,label:'test'})
  await exportCuttingPdf(plan,'作品',buildAssemblyGuide(cuts,display))
  expect(doc.text.mock.calls.map(c=>c[0]).filter((t:string)=>t.startsWith('+ 1-'))).toEqual(cuts.map(c=>`+ 1-${c.step}`))
  for(const [text,,y] of doc.text.mock.calls)if(String(text).startsWith('+')) expect(y).toBeLessThan(285)
  expect(doc.addPage).toHaveBeenCalledTimes(3) // 2 compact making pages + 1 scene page
})
it('uses a single safe-margin A4 image sheet with no printed frame or clipping',async()=>{
  const plan=planCuttingPages([{...rect('bg',1,1),imageUrl:'original'}],{mode:'specific',targetLongEdgeMm:600,label:'large'})
  await exportCuttingPdf(plan,'large')
  expect(plan.pages).toHaveLength(1)
  expect(doc.clip).not.toHaveBeenCalled();expect(doc.rect).not.toHaveBeenCalled()
  for(const call of doc.addImage.mock.calls){expect(call[2]).toBe(12);expect(call[3]).toBe(12);expect(call[4]).toBe(273)}
  expect(doc.text.mock.calls.map(c=>c[0])).toEqual(['1-1'])
  expect(doc.viewerPreferences).toHaveBeenCalledWith({PrintScaling:'None',PickTrayByPDFSize:true})
})
it('uses explicit pure-black 0.3 mm cutting strokes without changing contour coordinates',async()=>{
  const plan=planCuttingPages([rect('red',1,1)],{mode:'specific',targetLongEdgeMm:50,label:'test'})
  await exportCuttingPdf(plan,'contours')
  expect(doc.setDrawColor).toHaveBeenCalledWith('#000000');expect(doc.setLineWidth).toHaveBeenCalledWith(.3)
  expect(doc.lines.mock.calls[0][3]).toEqual([1,1]);expect(doc.fillStrokeEvenOdd).toHaveBeenCalled()
})

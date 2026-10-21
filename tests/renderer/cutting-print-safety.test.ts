import { expect, it } from 'vitest'
import { planCuttingPages, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'
import { choiceFromMetaphor } from '../../src/renderer/src/projection/subject-size'
import { exportPrintCalibrationPdf } from '../../src/renderer/src/projection/print-calibration-pdf'
const rect=(x:number,y:number,w:number,h:number)=>[[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]] as CutPiece['rings']
it('keeps roofs and tilted envelope layers on the exact same X/Y scale across real page breaks',()=>{
  const rotate=(rings:CutPiece['rings'])=>rings.map(ring=>ring.map(([x,y])=>[x*.8-y*.6,x*.6+y*.8] as [number,number]))
  const pieces:CutPiece[]=[
    {id:'bg',element:1,step:1,color:'#ACD9E5',rings:rect(0,0,1302,858),backgroundFrame:{width:1302,height:858}},
    ...Array.from({length:4},(_,i)=>({id:'roof'+i,element:1,step:i+2,color:'#C18F63',rings:rect(120,100+i*3,1000,300)})),
    {id:'envelope-body',element:2,step:1,color:'#FF5547',rings:rotate(rect(0,0,140,200))},
    {id:'envelope-flap',element:2,step:2,color:'#FFAB77',rings:rotate(rect(0,0,140,50))},
    {id:'envelope-seal',element:2,step:3,color:'#FFFF77',rings:rotate(rect(50,40,30,30))}
  ]
  const before=JSON.stringify(pieces),plan=planCuttingPages(pieces,choiceFromMetaphor('book')!)
  expect(plan.pages.length).toBeGreaterThan(1)
  const placed=plan.pages.flatMap(page=>page.pieces)
  expect(placed).toHaveLength(pieces.length);expect(new Set(placed.map(p=>p.id)).size).toBe(pieces.length)
  for(const page of plan.pages)for(const item of page.pieces){
    expect(item.x).toBeGreaterThanOrEqual(12-1e-8);expect(item.y).toBeGreaterThanOrEqual(12-1e-8)
    expect(item.x+item.width).toBeLessThanOrEqual((page.landscape?297:210)-12+1e-8)
    expect(item.y+item.height).toBeLessThanOrEqual((page.landscape?210:297)-18+1e-8)
    const original=pieces.find(p=>p.id===item.id)!
    for(let r=0;r<original.rings.length;r++)for(let n=1;n<original.rings[r].length;n++){
      for(const axis of [0,1]) expect(item.rings[r][n][axis]-item.rings[r][0][axis]).toBeCloseTo(
        (original.rings[r][n][axis]-original.rings[r][0][axis])*plan.scale,10)
    }
  }
  expect(JSON.stringify(pieces)).toBe(before)
})
it('caps the whole work if an outlying layer is taller than the background, never only that layer',()=>{
  const pieces:CutPiece[]=[{id:'bg',element:1,step:1,color:'#FFFFFF',rings:rect(0,0,1302,858),backgroundFrame:{width:1302,height:858}},
    {id:'tall',element:2,step:1,color:'#FF0000',rings:rect(0,0,50,1000)}]
  const plan=planCuttingPages(pieces,choiceFromMetaphor('book')!)
  expect(plan.scale).toBe(.18)
  expect(plan.pages.flatMap(p=>p.pieces).find(p=>p.id==='bg')!.width).toBeCloseTo(1302*.18)
  expect(plan.pages.flatMap(p=>p.pieces).find(p=>p.id==='tall')!.height).toBe(180)
})
it('retains a rotated envelope body and flap scale when they must be placed on different sheets',()=>{
  const tilted=(w:number,h:number)=>rect(0,0,w,h).map(r=>r.map(([x,y])=>[x*.8-y*.6,x*.6+y*.8] as [number,number]))
  const pieces:CutPiece[]=[{id:'body',element:2,step:1,color:'#FF5547',rings:tilted(90,60),backgroundFrame:{width:100,height:60}},
    {id:'flap',element:2,step:2,color:'#FFAB77',rings:tilted(90,20)}]
  const plan=planCuttingPages(pieces,choiceFromMetaphor('book')!)
  expect(plan.pages.findIndex(p=>p.pieces.some(c=>c.id==='body'))).not.toBe(plan.pages.findIndex(p=>p.pieces.some(c=>c.id==='flap')))
  for(const item of plan.pages.flatMap(p=>p.pieces)){
    const original=pieces.find(p=>p.id===item.id)!
    const edge=[original.rings[0][1][0]-original.rings[0][0][0],original.rings[0][1][1]-original.rings[0][0][1]]
    expect(item.rings[0][1][0]-item.rings[0][0][0]).toBeCloseTo(edge[0]*plan.scale)
    expect(item.rings[0][1][1]-item.rings[0][0][1]).toBeCloseTo(edge[1]*plan.scale)
  }
})
it('creates a separate one-page actual-size calibration PDF',async()=>{
  const text=await exportPrintCalibrationPdf().text()
  expect(text).toContain('/Count 1');expect(text).toContain('/PrintScaling /None')
  expect(text).toContain('/PickTrayByPDFSize true')
})

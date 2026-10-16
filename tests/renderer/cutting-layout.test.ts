import { describe, it, expect } from 'vitest'
import { planCuttingPages, transformCuts, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'
import type { CuttingGeometry, CutPolygon } from '../../src/shared/cutting-pattern'
const rect = (x: number, y: number, w: number, h: number): CutPolygon => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]
const piece = (id: string, color: string, rings: CutPolygon, step = 1): CutPiece => ({ id, color, rings, step, element: 1 })
const size = (mm: number) => ({ mode: 'metaphor' as const, targetLongEdgeMm: mm, label: 'test' })
describe('physical color cutting sheets', () => {
  it('groups final colors across steps without changing assembly sequence or individual scale', () => {
    const plan = planCuttingPages([piece('a','#ff0000',rect(0,0,100,100)),piece('b','#0000ff',rect(10,10,10,10),2),piece('c','#FF0000',rect(20,20,20,20),3)],size(100))
    expect(plan.pages.map(p=>p.color)).toEqual(['#FF0000','#0000FF'])
    expect(plan.pages[0].pieces.map(p=>[p.id,p.step,p.width,p.number])).toEqual([['a',1,100,1],['c',3,20,3]])
    expect(plan.pages[1].pieces[0].width).toBe(10)
    expect(plan.widthMm).toBe(100)
  })
  it('continues a color onto additional pages, retaining common scale and printable bounds', () => {
    const cuts = Array.from({length:12},(_,i)=>piece(String(i),'#123456',rect(0,0,90,90)))
    const plan = planCuttingPages(cuts,size(90))
    expect(plan.pages).toHaveLength(3)
    expect(plan.pages.flatMap(p=>p.pieces)).toHaveLength(12)
    for(const page of plan.pages) for (const p of page.pieces) {
      expect(p.width).toBe(90); expect(p.x).toBeGreaterThanOrEqual(12); expect(p.x+p.width).toBeLessThanOrEqual(198)
      expect(p.y).toBeGreaterThanOrEqual(30); expect(p.y+p.height+6).toBeLessThanOrEqual(267)
      for (const q of page.pieces) if(q!==p) expect(p.x+p.width<=q.x || q.x+q.width<=p.x || p.y+p.height+6<=q.y || q.y+q.height+6<=p.y).toBe(true)
    }
  })
  it('rejects oversize and invalid choices rather than silently shrinking a piece', () => {
    expect(()=>planCuttingPages([piece('a','#123456',rect(0,0,1,1))],size(200))).toThrow('超过 A4')
    expect(()=>planCuttingPages([piece('a','#123456',rect(0,0,1,1))],size(NaN))).toThrow('尺寸无效')
    expect(()=>planCuttingPages([],size(80))).toThrow('没有可导出')
  })
  it('keeps holes and disconnected polygons, native centering, scene rotation, mirroring and recolors', () => {
    const g: CuttingGeometry = {resultSha256:'hash',sourceSha256:'source',width:100,height:100,pieces:[{id:'p',color:'#123456',step:2,polygons:[[...rect(10,10,10,10),...rect(12,12,4,4)],rect(40,40,5,5)]}]}
    const cuts=transformCuts(g,{left:100,top:200,scaleX:-2,scaleY:1,angle:90},1,new Map([['p','#FF0000']]))
    expect(cuts).toHaveLength(2); expect(cuts[0].rings).toHaveLength(2)
    expect(cuts[0].rings[0][0][0]).toBeCloseTo(140);expect(cuts[0].rings[0][0][1]).toBeCloseTo(280)
    expect(cuts[0].color).toBe('#FF0000')
    const plan=planCuttingPages(cuts,size(60));expect(plan.pages[0].pieces[0].rings).toHaveLength(2)
  })
  it('uses the assembled foreground bounds, not the padded canvas or independent piece bounds',()=>{
    const plan=planCuttingPages([piece('a','#000000',rect(500,500,100,50)),piece('b','#FFFFFF',rect(600,500,100,50))],{...size(100),boundsMm:{width:100,height:100}})
    expect(plan.scale).toBe(.5); expect(plan.widthMm).toBe(100);expect(plan.heightMm).toBe(25)
    expect(plan.pages[0].pieces[0].width).toBe(50);expect(plan.pages[1].pieces[0].width).toBe(50)
  })
  it('does not merge source pieces or substitute a backing contour during layout',()=>{
    const g: CuttingGeometry = {resultSha256:'hash',sourceSha256:'source',width:100,height:100,
      pieces:[{id:'a',color:'#123456',step:1,polygons:[rect(0,0,50,100)]},{id:'b',color:'#123456',step:1,polygons:[rect(50,0,50,100)]}],
      backing:{pieceIds:['a','b'],polygons:[[...rect(0,0,100,100),...rect(40,40,20,20)]]}}
    const t={left:50,top:50,scaleX:1,scaleY:1,angle:0}
    const cuts=transformCuts(g,t,1)
    expect(cuts).toHaveLength(2);expect(cuts[0].rings).toHaveLength(1)
    expect(planCuttingPages(cuts,size(100)).pages[0].pieces[0].width).toBe(50)
    expect(transformCuts(g,t,1,new Map([['a','#FF0000'],['b','#0000FF']]))).toHaveLength(2)
    g.backing!.polygons=[rect(0,0,20,20),rect(50,0,20,20)]
    expect(transformCuts(g,t,1)).toHaveLength(2)
  })
  it('keeps all small details, thin strips and holes unchanged regardless of output size',()=>{
    const source=[piece('base','#FFFFFF',[...rect(0,0,100,100),...rect(40,40,.1,.1)]),piece('tiny','#FF0000',rect(20,20,.1,.1),2),piece('thin','#123456',rect(30,30,.1,20),3)]
    const before=JSON.stringify(source)
    for(const mm of [50,150]){
      const plan=planCuttingPages(source,size(mm))
      expect(plan.pieceCount).toBe(3)
      expect(plan.pages.flatMap(p=>p.pieces).find(p=>p.id==='base')!.rings).toHaveLength(2)
      expect(plan.pages.flatMap(p=>p.pieces).find(p=>p.id==='tiny')!.width).toBeCloseTo(.1*mm/100)
    }
    expect(JSON.stringify(source)).toBe(before)
  })
})

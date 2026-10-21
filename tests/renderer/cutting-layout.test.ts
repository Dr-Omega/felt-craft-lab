import { describe, it, expect } from 'vitest'
import { planCuttingPages, transformCuts, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'
import type { CuttingGeometry, CutPolygon } from '../../src/shared/cutting-pattern'
import { choiceFromMetaphor, defaultSubjectSizeChoice } from '../../src/renderer/src/projection/subject-size'
const rect = (x: number, y: number, w: number, h: number): CutPolygon => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]
const piece = (id: string, color: string, rings: CutPolygon, step = 1): CutPiece => ({ id, color, rings, step, element: 1 })
const size = (mm: number) => ({ mode: 'metaphor' as const, targetLongEdgeMm: mm, label: 'test' })
describe('physical mixed-color cutting sheets', () => {
  it('defaults to an 18 cm long edge, fitting landscape, portrait and square cuts on A4 without stretching', () => {
    const choice = defaultSubjectSizeChoice()
    expect(choice.targetLongEdgeMm).toBe(180)
    for (const [w, h] of [[100,100],[200,100],[100,200]]) {
      const plan = planCuttingPages([piece('single','#3575CF',rect(0,0,w,h))], choice)
      expect(Math.max(plan.widthMm, plan.heightMm)).toBeCloseTo(180)
      expect(plan.widthMm / plan.heightMm).toBeCloseTo(w / h)
      expect(plan.pages[0].pieces[0].x + plan.widthMm).toBeLessThanOrEqual(198)
    }
  })
  it('shares paper across colors in making order without changing individual scale', () => {
    const plan = planCuttingPages([piece('a','#ff0000',rect(0,0,100,100)),piece('b','#0000ff',rect(10,10,10,10),2),piece('c','#FF0000',rect(20,20,20,20),3)],size(100))
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0].pieces.map(p=>[p.id,p.step,p.width,p.number,p.color])).toEqual([['a',1,100,1,'#FF0000'],['b',2,10,2,'#0000FF'],['c',3,20,3,'#FF0000']])
    expect(plan.widthMm).toBe(100)
  })
  it('continues onto additional pages, retaining common scale and printable bounds', () => {
    const cuts = Array.from({length:12},(_,i)=>piece(String(i),'#123456',rect(0,0,90,90),i+1))
    const plan = planCuttingPages(cuts,size(90))
    expect(plan.pages).toHaveLength(3)
    expect(plan.pages.flatMap(p=>p.pieces)).toHaveLength(12)
    for(const page of plan.pages) for (const p of page.pieces) {
      expect(p.width).toBe(90); expect(p.x).toBeGreaterThanOrEqual(12); expect(p.x+p.width).toBeLessThanOrEqual(198)
      expect(p.y).toBeGreaterThanOrEqual(12); expect(p.y+p.height+6).toBeLessThanOrEqual(285)
      for (const q of page.pieces) if(q!==p) expect(p.x+p.width<=q.x || q.x+q.width<=p.x || p.y+p.height+6<=q.y || q.y+q.height+6<=p.y).toBe(true)
    }
  })
  it('keeps elements and their making layers together even when the source arrives out of order', () => {
    const source = [
      {...piece('e2-l2','#123456',rect(0,0,20,20),2),element:2},
      piece('e1-l2','#FF0000',rect(0,0,20,20),2),
      {...piece('e2-l1','#FFFFFF',rect(0,0,20,20)),element:2},
      piece('e1-l1-a','#000000',rect(0,0,10,10)),piece('e1-l1-b','#000000',rect(12,0,10,10))
    ]
    const plan = planCuttingPages(source,size(40))
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0].pieces.map(p=>p.id)).toEqual(['e1-l1-a','e1-l1-b','e1-l2','e2-l1','e2-l2'])
    expect(source[0].id).toBe('e2-l2')
  })
  it('keeps disconnected parts in their original relative positions and labels their layer only once', () => {
    const source = [piece('a','#FF0000',rect(0,0,10,10)),piece('b','#FF0000',rect(40,20,10,10))]
    const plan = planCuttingPages(source,size(100))
    expect(plan.pieceCount).toBe(2)
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0].labels).toEqual([{element:1,step:1,x:12,y:76}])
    const [a,b]=plan.pages[0].pieces
    expect(b.x-a.x).toBe(80); expect(b.y-a.y).toBe(40)
    expect(a.width).toBe(20); expect(b.width).toBe(20)
  })
  it('fills an earlier page with small later cuts instead of leaving its row space unused', () => {
    const plan = planCuttingPages([
      piece('tall','#FFFFFF',rect(0,0,120,180)),
      piece('wide','#FF0000',rect(0,0,180,100),2),
      piece('small','#000000',rect(0,0,40,50),3)
    ],size(180))
    expect(plan.pages).toHaveLength(2)
    expect(plan.pages[0].pieces.map(p=>p.id)).toEqual(['tall','small'])
    expect(plan.pages[1].pieces.map(p=>p.id)).toEqual(['wide'])
  })
  it('packs many tiny mixed-color cuts with enough room for each numeric label', () => {
    const cuts = Array.from({length:60},(_,i)=>piece(String(i),i%2?'#FF0000':'#000000',rect(0,0,1,1),i+1))
    const plan = planCuttingPages(cuts,size(1))
    expect(plan.pages).toHaveLength(1)
    for (const p of plan.pages[0].pieces) for (const q of plan.pages[0].pieces) if(p!==q) {
      const pw=Math.max(p.width,`${p.element}-${p.step}`.length*2+1),qw=Math.max(q.width,`${q.element}-${q.step}`.length*2+1)
      expect(p.x+pw+6<=q.x+1e-8 || q.x+qw+6<=p.x+1e-8 || p.y+p.height+12<=q.y+1e-8 || q.y+q.height+12<=p.y+1e-8).toBe(true)
    }
  })
  it('caps book-size artwork to landscape A4 safe margins with one uniform scale', () => {
    const plan=planCuttingPages([piece('a','#123456',rect(0,0,1302,858))],choiceFromMetaphor('book')!)
    expect(plan.pages).toHaveLength(1);expect(plan.pages[0].landscape).toBe(true)
    expect(plan.widthMm).toBeCloseTo(273);expect(plan.pages[0].pieces[0].width).toBeCloseTo(273)
    expect(plan.pages[0].pieces[0].height).toBeCloseTo(858/1302*273)
    expect(plan.pages[0].pieces[0].x).toBeCloseTo(12)
  })
  it('caps oversize artwork to one A4 with a shared scale, preserving holes and every material', () => {
    const source=[piece('a','#123456',[...rect(0,0,100,100),...rect(40,40,20,20)]),piece('b','#FF0000',rect(10,10,10,10),2)]
    const before=JSON.stringify(source),plan=planCuttingPages(source,size(400))
    expect(plan.pages).toHaveLength(1)
    expect(plan.scale).toBe(1.86);expect(plan.widthMm).toBe(186)
    expect(plan.pages[0].pieces[0].rings).toHaveLength(2)
    expect(plan.pages[0].pieces[0].width).toBe(186)
    expect(plan.pages[0].pieces[1].width).toBeCloseTo(18.6)
    expect(plan.pages[0].pieces[1].y).toBeGreaterThan(plan.pages[0].pieces[0].y+186+6)
    expect(JSON.stringify(source)).toBe(before)
  })
  it('fits intact backgrounds on one A4 and rejects invalid sizes', () => {
    const source={...piece('image','#FFFFFF',rect(0,0,100,100)),imageUrl:'data:image/png;base64,test'}
    const plan=planCuttingPages([source],size(400))
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages.every(p=>p.pieces[0].imageUrl===source.imageUrl)).toBe(true)
    expect(planCuttingPages([source],size(100000)).widthMm).toBe(186)
    expect(()=>planCuttingPages([piece('a','#123456',rect(0,0,1,1))],size(NaN))).toThrow('尺寸无效')
    expect(()=>planCuttingPages([],size(80))).toThrow('没有可导出')
  })
  it('fits landscape, portrait and square book-size backgrounds to A4 without stretching or overflowing',()=>{
    for(const [w,h] of [[1302,858],[858,1302],[100,100],[120,100]]){
      const source={...piece('bg','#FFFFFF',rect(0,0,w,h)),backgroundFrame:{width:w,height:h}}
      const plan=planCuttingPages([source],choiceFromMetaphor('book')!)
      expect(plan.pages).toHaveLength(1)
      const p=plan.pages[0],cut=p.pieces[0],pw=p.landscape?297:210,ph=p.landscape?210:297
      expect(cut.width/cut.height).toBeCloseTo(w/h)
      expect(cut.x).toBeGreaterThanOrEqual(12);expect(cut.y).toBeGreaterThanOrEqual(12)
      expect(cut.x+cut.width).toBeLessThanOrEqual(pw-12+1e-7);expect(cut.y+cut.height+6).toBeLessThanOrEqual(ph-12+1e-7)
      expect(Math.abs(cut.width-(pw-24))<1e-7||Math.abs(cut.height-(ph-30))<1e-7).toBe(true)
    }
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
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0].pieces.map(p=>p.width)).toEqual([50,50])
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

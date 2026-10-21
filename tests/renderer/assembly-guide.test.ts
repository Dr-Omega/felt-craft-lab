import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildAssemblyGuide, guideBounds } from '../../src/renderer/src/projection/assembly-guide'
import type { CutPiece } from '../../src/renderer/src/projection/cutting-layout'
import type { WorkDisplay } from '../../src/renderer/src/workflows/work-display'

const rect=(id:string,element:number,step:number,x=0,y=0):CutPiece=>({id,element,step,color:'#3575CF',rings:[[[x,y],[x+30,y],[x+30,y+20],[x,y+20]]]})
const display=(background=true):WorkDisplay=>({width:200,height:100,
  layers:[...(background?[{id:'background',label:'场景背景',image:'bg',background:true}]:[]),
    {id:'lantern',label:'灯笼',image:'lantern',background:false},{id:'fuwa',label:'福娃',image:'fuwa',background:false}],
  assemblies:background?['bg','bg+lantern','bg+lantern+fuwa']:['lantern','lantern+fuwa']})

describe('PDF-only cumulative making instructions',()=>{
  it('orders elements then bottom-to-top layers, accumulating every island at its original position and color',()=>{
    const cuts=[rect('f2',3,2,105,55),rect('b2',1,2),rect('l2',2,2,20,15),rect('l1',2,1,10,10),
      rect('b1',1,1),rect('f1',3,1,100,50),rect('l2-island',2,2,30,15)]
    cuts[2].rings.push([[22,17],[24,17],[24,19],[22,19]])
    const before=JSON.stringify(cuts),guide=buildAssemblyGuide(cuts,display())
    expect(guide.groups.map(g=>g.kind)).toEqual(['element','element','element','scene'])
    expect(guide.groups[1].steps.map(s=>s.label)).toEqual(['2-1','2-2'])
    expect(guide.groups[1].steps[1].added.map(p=>p.id)).toEqual(['l2','l2-island'])
    expect(guide.groups[1].steps[1].pieces.map(p=>p.id)).toEqual(['l1','l2','l2-island'])
    expect(guide.groups[1].steps[1].pieces[1].rings).toHaveLength(2)
    expect(guide.groups[1].bounds).toEqual({x:10,y:10,width:50,height:25})
    expect(guide.groups[1].steps[1].added[0].color).toBe('#3575CF')
    expect(JSON.stringify(cuts)).toBe(before)
  })
  it('uses saved cumulative scene images, all elements once, with the same numbers as cutting pages',()=>{
    const cuts=[rect('b',1,1),rect('l',2,1),rect('f',3,1)]
    const group=buildAssemblyGuide(cuts,display()).groups.at(-1)!
    expect(group.title).toBe('整体叠放');expect(group.bounds).toEqual({x:0,y:0,width:200,height:100})
    expect(group.steps.map(s=>s.label)).toEqual(['1','2','3'])
    expect(group.steps.map(s=>s.imageUrl)).toEqual(display().assemblies)
    expect(group.steps[2].added[0].element).toBe(3)
  })
  it('prints an intact background only in final scene assembly, not as invented internal layers',()=>{
    const bg={...rect('bg',1,1),imageUrl:'background-png'}
    const guide=buildAssemblyGuide([bg,rect('l',2,1),rect('f',3,1)],display())
    expect(guide.groups.map(g=>g.title)).toEqual(['2 · 灯笼','3 · 福娃','整体叠放'])
    expect(guide.groups.at(-1)!.steps[0].added).toEqual([bg])
  })
  it('does not invent a UI white background for a transparent work',()=>{
    const guide=buildAssemblyGuide([rect('l',1,1),rect('f',2,1)],display(false))
    expect(guide.groups[0].title).toBe('1 · 灯笼')
    expect(guide.groups.at(-1)!.steps.map(s=>s.imageUrl)).toEqual(['lantern','lantern+fuwa'])
  })
  it('rejects missing or mismatched layers instead of silently skipping an instruction',()=>{
    expect(()=>buildAssemblyGuide([rect('l',2,1)],display())).toThrow('编号与作品元素不一致')
    expect(()=>buildAssemblyGuide([rect('bad',4,1),rect('l',2,1),rect('f',3,1)],display())).toThrow('编号与作品元素不一致')
    expect(()=>buildAssemblyGuide([], {...display(),assemblies:[]})).toThrow('作品图层不一致')
    expect(()=>guideBounds([])).toThrow('范围无效')
  })
  it('builds the instructions only at PDF download time and keeps them out of the UI preview',()=>{
    const page=readFileSync('src/renderer/src/pages/WorkDisplayPage.vue','utf8')
    expect(page).toContain('exportCuttingPdf(next, work.projectName, guide)')
    expect(page.slice(page.indexOf('<template>'))).not.toContain('AssemblyGuide')
    expect(readFileSync('src/renderer/src/components/projection/v2/CuttingPreview.vue','utf8')).not.toContain('assembly')
  })
})

import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { canonicalPayloadJson } from '../../src/shared/contracts/fabrication-validation'
import { readCuttingGeometry } from '../../src/main/fabrication/cutting-geometry'
import type { FabricationView } from '../../src/shared/fabrication-desktop'
function fixture() {
  const result={schemaVersion:'fabrication.layered-result/1',identity:{sha256:''},payload:{input:{coordinates:{canonicalFrameId:'c',frames:[{id:'c',bounds:[0,0,100,100],yDirection:'DOWN'}],transforms:[{matrix:[1,0,0,1,0,0]}]}},pieces:[{id:'p',colorSlotId:'red',rgb:[255,0,0],full:{type:'Polygon',coordinates:[[[0,0],[80,0],[80,80],[0,80],[0,0]]]},visible:{type:'Polygon',coordinates:[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}}]}}
  result.identity.sha256=createHash('sha256').update(canonicalPayloadJson(result.payload)).digest('hex')
  const view: FabricationView={schemaVersion:'desktop-fabrication-view/1',resultSha256:result.identity.sha256,sourceSha256:'source',width:100,height:100,pieceCount:1,steps:[{step:1,colorSlotId:'red',rgb:[255,0,0],pieceIds:['p'],pieceNumbers:[1],asset:'step-1'}],stepCount:1,materialDepth:1,assets:{},geometryStatus:'PASS',visualAcceptance:'PENDING',manufacturing:'NOT_EVALUATED',productionExportEligible:false}
  return {result,view}
}
describe('cutting geometry boundary (synthetic fixtures, not runtime acceptance)',()=>{
  it('reads full hidden-completed geometry rather than visible fragment, without promoting manufacturing status',()=>{
    const {result,view}=fixture(), geometry=readCuttingGeometry(result,view)
    expect(geometry.pieces[0].polygons[0][0][1]).toEqual([80,0]);expect(view.productionExportEligible).toBe(false)
  })
  it('rejects changed result bytes, incomplete schedules and coordinate changes',()=>{
    const {result,view}=fixture();result.payload.pieces[0].full.coordinates[0][1][0]=79
    expect(()=>readCuttingGeometry(result,view)).toThrow('不一致')
    const b=fixture();b.view.steps[0].pieceIds=['other'];expect(()=>readCuttingGeometry(b.result,b.view)).toThrow()
    const c=fixture();c.view.width=90;expect(()=>readCuttingGeometry(c.result,c.view)).toThrow()
  })
  it('rejects open or degenerate rings even with a matching identity',()=>{
    for(const ring of [[[0,0],[10,0],[10,10],[0,1]],[[0,0],[1,0],[2,0],[0,0]]]) {
      const {result,view}=fixture();result.payload.pieces[0].full.coordinates=[ring]
      result.identity.sha256=createHash('sha256').update(canonicalPayloadJson(result.payload)).digest('hex');view.resultSha256=result.identity.sha256
      expect(()=>readCuttingGeometry(result,view)).toThrow('不一致')
    }
  })
  it('exposes only hash-bound declared backing geometry and rejects dangling backing members',()=>{
    const {result,view}=fixture()
    const raw = {...result,payload:{...result.payload,wholeSilhouetteBase:{rule:'whole-silhouette-base/1',basePieceIds:['p'],selectedColorSlotId:'red',supportDomain:result.payload.pieces[0].full}}}
    raw.identity.sha256=createHash('sha256').update(canonicalPayloadJson(raw.payload)).digest('hex');view.resultSha256=raw.identity.sha256
    expect(readCuttingGeometry(raw,view).backing?.pieceIds).toEqual(['p'])
    raw.payload.wholeSilhouetteBase.basePieceIds=['other']
    raw.identity.sha256=createHash('sha256').update(canonicalPayloadJson(raw.payload)).digest('hex');view.resultSha256=raw.identity.sha256
    expect(()=>readCuttingGeometry(raw,view)).toThrow('不一致')
  })
})

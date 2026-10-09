import { describe,it,expect } from 'vitest'
import { SYNC_TABLES,workspaceFingerprint,type WorkspaceDocument,type SyncTables } from '../../src/shared/workspace-sync'
function document():WorkspaceDocument {return {schema:'account-workspace/1',userId:'a',tables:Object.fromEntries(SYNC_TABLES.map(k=>[k,[]])) as unknown as SyncTables,recolor:{},files:[]}}
describe('workspace sync identity',()=>{
  it('ignores table iteration ordering but preserves scene layer ordering',()=>{
    const a=document();a.tables.projects=[{id:1,scene:{objects:[{id:'top'},{id:'bottom'}]}},{id:2}]
    const b=structuredClone(a);b.tables.projects.reverse()
    expect(workspaceFingerprint(a)).toBe(workspaceFingerprint(b))
    ;(b.tables.projects[1].scene as {objects:unknown[]}).objects.reverse()
    expect(workspaceFingerprint(a)).not.toBe(workspaceFingerprint(b))
  })
  it('includes user, colors and metadata instead of caching an old PASS',()=>{
    const a=document(),b=document();b.userId='b'
    expect(workspaceFingerprint(a)).not.toBe(workspaceFingerprint(b))
    b.userId='a';b.recolor={v:{colors:['#ffffff']}}
    expect(workspaceFingerprint(a)).not.toBe(workspaceFingerprint(b))
  })
})

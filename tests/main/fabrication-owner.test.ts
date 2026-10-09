import { expect, it, vi } from 'vitest'
import type { FabricationJob } from '../../src/shared/fabrication-desktop'
import { validScene } from '../shared/contracts.fixtures'
vi.mock('electron',()=>({app:{},ipcMain:{}}))
import { ownsFabricationJob } from '../../src/main/fabrication/ipc'
const job: FabricationJob={id:'job',status:'failed',startedAt:0,message:''}
it('does not automatically claim legacy unbound jobs for any login',()=>{
 expect(ownsFabricationJob(job,'first')).toBe(false)
 expect(ownsFabricationJob(job,'second')).toBe(false)
})
it('uses authenticated ownership for standalone jobs and rejects a different account',()=>{
 expect(ownsFabricationJob({...job,ownerUserId:'first'},'first')).toBe(true)
 expect(ownsFabricationJob({...job,ownerUserId:'first'},'second')).toBe(false)
})
it('preserves bound legacy ownership but rejects contradictory binding and owner',()=>{
 const bound={...job,binding:{scene:structuredClone(validScene)}}
 expect(ownsFabricationJob(bound,validScene.userId)).toBe(true)
 expect(ownsFabricationJob({...bound,ownerUserId:'second'},'second')).toBe(false)
 expect(ownsFabricationJob({...bound,ownerUserId:'second'},validScene.userId)).toBe(false)
})

import { describe,expect,it } from 'vitest'
import { sameElementSource } from '../../src/shared/fabrication-task-identity'
import { validScene } from './contracts.fixtures'
describe('element task identity',()=>{
  it('ignores only scene placement/timestamps, not object, owner, catalog, or asset identity',()=>{
    const a={scene:structuredClone(validScene),objectId:validScene.objects[0].objectId}
    const b=structuredClone(a);b.scene.objects[0].left+=3;b.scene.updatedAt='2026-10-08T00:00:00Z'
    expect(sameElementSource(a,b)).toBe(true)
    b.scene.objects[0].assetId='different';expect(sameElementSource(a,b)).toBe(false)
    const c=structuredClone(a);c.scene.userId='another';expect(sameElementSource(a,c)).toBe(false)
    expect(()=>sameElementSource(a,{...a,objectId:'missing'})).toThrow()
  })
})

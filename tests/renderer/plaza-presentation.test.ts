import { expect, it } from 'vitest'
import { excerptLineMix, plazaAvatarIndex, plazaAvatarCrop } from '../../src/renderer/src/services/plaza-presentation'
it('supports empty, single and arbitrary real feed lengths and mixes the first pair',()=>{
  for(let count=0;count<40;count++)for(const random of [()=>0,()=>.99]){
    const lines=excerptLineMix(count,random)
    expect(lines).toHaveLength(count)
    expect(lines.every(line=>line===1||line===2)).toBe(true)
    if(count>1)expect(lines[0]).not.toBe(lines[1])
  }
  expect(excerptLineMix(8,()=>0).filter(line=>line===1)).toHaveLength(2)
  expect(excerptLineMix(8,()=>.99).filter(line=>line===1)).toHaveLength(6)
})
it('uses stable existing avatar art without introducing fabricated user profiles',()=>{
  expect(plazaAvatarIndex('user-a')).toBe(plazaAvatarIndex('user-a'))
  for(const id of ['a','b','c'])expect(plazaAvatarIndex(id)).toBeLessThan(3)
  expect(plazaAvatarCrop(0).width).toContain('%')
})

import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { exportV2HitAreas, exportFinishOffsetPercent } from '../../src/renderer/src/ui/export-v2-assets'
import { planCuttingPages, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'

it('centers finish artwork and hit target at the same stage position', () => {
  expect(exportV2HitAreas.finish.left + exportV2HitAreas.finish.width / 2).toBe(960)
  expect(956 + exportFinishOffsetPercent / 100 * 1920).toBe(exportV2HitAreas.finish.left)
})
it('connects explode background selection to export and invalidates prepared cuts on a change', () => {
  const page = readFileSync('src/renderer/src/pages/WorkDisplayPage.vue','utf8')
  expect(page).toContain("backgroundMode: includeBackground.value ? 'layers' : 'image'")
  expect(page).toContain('watch(includeBackground')
})
it('uses the same scene scale for split and intact backgrounds, including transparent edges', () => {
  const piece: CutPiece = {id:'background',color:'#FFFFFF',element:1,step:1,
    rings:[[[20,0],[80,0],[80,60],[20,60],[20,0]]],backgroundFrame:{width:100,height:60}}
  const size={mode:'specific' as const,targetLongEdgeMm:180,label:'18cm'}
  const split=planCuttingPages([piece],size)
  const flat=planCuttingPages([{...piece,rings:[[[0,0],[100,0],[100,60],[0,60],[0,0]]],imageUrl:'data:image/png;base64,test'}],size)
  expect(split.scale).toBe(1.8);expect(flat.scale).toBe(split.scale)
  expect(flat.pages[0].pieces[0].imageUrl).toBe('data:image/png;base64,test')
})

import { describe, expect, it } from 'vitest'
import { exportLayoutPdf, layoutLayersOnPages, type LayoutLayerInput } from '../../src/renderer/src/projection/pdf-layout'
import { choiceFromMetaphor, choiceFromSpecificCm, layoutOptionsForSubject } from '../../src/renderer/src/projection/subject-size'
import type { ProjectionLayerDescriptor } from '../../src/renderer/src/projection/projection-layers'

function makeLayer(
  layerNumber: number,
  width: number,
  height: number
): LayoutLayerInput {
  const descriptor: ProjectionLayerDescriptor = {
    layerNumber,
    kind: 'sticker',
    assetId: `st-${layerNumber}`,
    label: `Layer ${layerNumber}`,
    imageUrl: 'felt-resource://material/mock.png',
    zIndex: layerNumber
  }
  return {
    descriptor,
    image: { width, height, objectUrl: `blob:mock-${layerNumber}` }
  }
}

describe('layoutLayersOnPages', () => {
  it.each([[400,800],[800,400],[400,400]])('uses the longer edge, not width, for %s × %s images', (w,h) => {
    const item=layoutLayersOnPages([makeLayer(1,w,h)],'a4',layoutOptionsForSubject(choiceFromMetaphor('apple')!))[0].placed[0]
    expect(Math.max(item.width,item.height)).toBeCloseTo(80)
    expect(item.width/item.height).toBeCloseTo(w/h)
  })
  it('honors both specific dimensions without stretching or imposing a 24 mm minimum',()=>{
    const choice=choiceFromSpecificCm(1,3)!
    const item=layoutLayersOnPages([makeLayer(1,400,800)],'a4',layoutOptionsForSubject(choice))[0].placed[0]
    expect(item.width).toBeCloseTo(10);expect(item.height).toBeCloseTo(20)
  })
  it('rejects oversized physical dimensions instead of silently shrinking them',()=>{
    expect(()=>layoutLayersOnPages([makeLayer(1,400,400)],'a4',layoutOptionsForSubject(choiceFromSpecificCm(50,50)!))).toThrow('未自动缩小')
  })
  it('does not export a misleading empty PDF',async()=>{
    await expect(exportLayoutPdf({workName:'empty',paper:'a4',layers:[]})).rejects.toThrow('没有可导出的图层')
  })
  it('keeps tall layers inside the printable page instead of clipping', () => {
    const placed=layoutLayersOnPages([makeLayer(1,1,1000)],'a4')[0].placed[0]
    expect(placed.y+placed.height).toBeLessThanOrEqual(285)
    expect(placed.width/placed.height).toBeCloseTo(.001,6)
  })
  it('rejects invalid dimensions and non-finite requested sizes', () => {
    expect(()=>layoutLayersOnPages([makeLayer(1,0,100)],'a4')).toThrow()
    expect(()=>layoutLayersOnPages([makeLayer(1,100,100)],'a4',{maxLayerWidthMm:Infinity})).toThrow()
  })
  it('packs multiple layers onto one page when they fit', () => {
    const pages = layoutLayersOnPages(
      [makeLayer(1, 400, 400), makeLayer(2, 400, 400), makeLayer(3, 400, 400)],
      'a4'
    )
    expect(pages).toHaveLength(1)
    expect(pages[0]?.placed).toHaveLength(3)
  })

  it('spills overflow layers onto additional pages', () => {
    const many = Array.from({ length: 24 }, (_, index) => makeLayer(index + 1, 800, 800))
    const pages = layoutLayersOnPages(many, 'a4')
    expect(pages.length).toBeGreaterThan(1)
    const placedCount = pages.reduce((sum, page) => sum + page.placed.length, 0)
    expect(placedCount).toBe(24)
  })

  it('preserves layer aspect ratio when sizing cells', () => {
    const pages = layoutLayersOnPages([makeLayer(1, 800, 400)], 'a4')
    const item = pages[0]?.placed[0]
    expect(item).toBeDefined()
    expect(item!.width / item!.height).toBeCloseTo(2, 1)
  })
})

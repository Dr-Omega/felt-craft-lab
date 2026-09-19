import { describe, expect, it } from 'vitest'
import { layoutLayersOnPages, type LayoutLayerInput } from '../../src/renderer/src/projection/pdf-layout'
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

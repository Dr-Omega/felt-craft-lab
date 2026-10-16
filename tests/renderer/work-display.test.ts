import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validProject } from '../shared/contracts.fixtures'
import { buildWorkDisplay } from '../../src/renderer/src/workflows/work-display'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), personal: vi.fn() }))
vi.mock('../../src/renderer/src/catalog/ywn-catalog', () => ({
  createCatalogResolver: () => ({ resolveAsset: mocks.resolve, resolvePersonalAsset: mocks.personal })
}))

// Track painted content rather than returning a constant data URL: a clearRect
// between the color and background image must be observable in these tests.
class TestCanvas {
  width = 0
  height = 0
  content: string[] = []
  getContext() {
    return {
      fillStyle: '',
      fillRect: () => { this.content.push('color') },
      clearRect: () => { this.content = [] },
      drawImage: (source: TestCanvas | { src: string }) => {
        this.content.push(...(source instanceof TestCanvas ? source.content : [source.src]))
      },
      save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, scale: () => {}
    }
  }
  toDataURL() { return JSON.stringify(this.content) }
}

beforeEach(() => {
  mocks.resolve.mockReset().mockImplementation(async id => ({ imageUrl: id, nameZh: id }))
  mocks.personal.mockReset()
  vi.stubGlobal('document', { createElement: () => new TestCanvas() })
  vi.stubGlobal('Image', class {
    src = ''; width = 100; height = 100
    async decode() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('saved-work background layers', () => {
  it('never bakes default UI paper into the scene background or foreground', async () => {
    const work = structuredClone(validProject), original = structuredClone(work)
    const display = await buildWorkDisplay(work)
    expect(display.layers.map(l => l.id)).toEqual(['background', work.scene.objects[0].objectId])
    expect(display.layers[0]).toMatchObject({ label: '场景背景', background: true })
    expect(JSON.parse(display.layers[0].image)).toEqual([work.scene.backgroundAssetId])
    expect(JSON.parse(display.assemblies.at(-1)!)).toEqual([work.scene.backgroundAssetId, work.scene.objects[0].assetId])
    // Foreground planes stay transparent; removing background leaves no paper.
    expect(display.layers.filter(l => !l.background).map(l => JSON.parse(l.image)))
      .toEqual([[work.scene.objects[0].assetId]])
    expect(display.assemblies).toHaveLength(display.layers.length)
    expect(work).toEqual(original)
  })

  it('uses the pinned personal background without filling transparent areas with UI paper', async () => {
    const work = structuredClone(validProject)
    work.scene.personalBackground = { personalAssetId: 'personal-bg', versionId: 'pinned-version' }
    mocks.personal.mockResolvedValue({ asset: { userId: work.scene.userId }, version: { sourceImageRef: 'personal-image' } })
    const display = await buildWorkDisplay(work)
    expect(mocks.personal).toHaveBeenCalledWith('personal-bg', 'pinned-version')
    expect(mocks.resolve).not.toHaveBeenCalledWith(work.scene.backgroundAssetId, expect.anything())
    expect(display.layers.filter(l => l.background)).toHaveLength(1)
    expect(JSON.parse(display.layers[0].image)).toEqual(['personal-image'])
  })

  it('does not create a background layer when only legacy UI paper is saved', async () => {
    const work = structuredClone(validProject)
    work.scene.backgroundAssetId = null
    const display = await buildWorkDisplay(work)
    expect(display.layers.every(l => !l.background)).toBe(true)
    expect(JSON.parse(display.assemblies[0])).toEqual([work.scene.objects[0].assetId])
  })

  it('retains explicitly chosen artwork colors, including white and the same color as UI paper', async () => {
    const work = structuredClone(validProject)
    work.scene.backgroundAssetId = null
    work.scene.canvas.backgroundColorSource = 'user'
    const display = await buildWorkDisplay(work)
    expect(display.layers[0]).toMatchObject({ id: 'background', label: '画布底色', background: true })
    expect(JSON.parse(display.layers[0].image)).toEqual(['color'])
    expect(display.layers.filter(l => !l.background)).toHaveLength(1)
    work.scene.canvas.backgroundColor = '#FFFFFF'
    expect((await buildWorkDisplay(work)).layers[0].background).toBe(true)
  })

  it('does not invent white paper for an image-only or transparent scene', async () => {
    const work = structuredClone(validProject)
    delete work.scene.canvas.backgroundColor
    const imageOnly = await buildWorkDisplay(work)
    expect(JSON.parse(imageOnly.layers[0].image)).toEqual([work.scene.backgroundAssetId])
    work.scene.backgroundAssetId = null
    const transparent = await buildWorkDisplay(work)
    expect(transparent.layers.every(l => !l.background)).toBe(true)
    expect(JSON.parse(transparent.assemblies[0])).toEqual([work.scene.objects[0].assetId])
  })
})

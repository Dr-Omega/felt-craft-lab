import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadFormalCatalog } from '../../src/renderer/src/catalog/load-formal-catalog'
import { contentProjection } from '../../src/renderer/src/catalog/content-version'
import { parseProvidedPsdLayers } from '../../src/renderer/src/projection/provided-psd-layers'
import current from '../../src/renderer/src/catalog/assets.manifest.json'
import previous from '../../src/renderer/src/catalog/snapshots/snapshot_ywn_material_v2_1cdf77d.manifest.json'
import index from '../../assets/generated/provided-psd-20261017.json'
import versions from '../../assets/generated/content-versions.json'

const catalog = loadFormalCatalog(current)
const bytes = (ref: string) => readFileSync('assets/generated/' + ref.replace('felt-resource://', ''))
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const replacements = new Map([
  ['background_couplet_gate_001', 'beijing'], ['sticker_red_envelope_001', 'hongbao'],
  ['sticker_dumpling_001', 'jiaozi'], ['sticker_lantern_001', 'denglong']
])
const originalHashes: Record<string, string> = {
  fuwa: '9ef26310f899518d55926b77d6f61dd79547f244e24aaddf2cb583698e903695',
  hongbao: 'd9a9b0348f3e09e3e785f3a68b64bf7d17bb67b1fcf1a3ea69a0b674b942a7f8',
  jiaozi: 'ff2d27cc9d208356ca26388ceb907d143a9b2515b8e769c9b77631cda78ce83a',
  denglong: 'de9728169aa5d336c626233b1679f18d60f61ec7969d731bd2ce2aeb51800520',
  beijing: 'fab9fab008d13ceaf1dd05115ee6a6ca7c202c3924d44ac4c5c0529ab9cd47a5'
}

describe('provided PSD source preservation and catalog replacement', () => {
  it('changes only the four requested images, preserving previous snapshot bytes, semantic IDs and audio', () => {
    expect(catalog.assetSnapshotId).toBe('snapshot_ywn_psd_20261017')
    expect(catalog.assets).toHaveLength(previous.assets.length)
    for (const asset of catalog.assets) {
      const old = previous.assets.find(a => a.assetId === asset.assetId)!
      expect(asset.nameZh).toBe(old.nameZh)
      expect(asset.themeId).toBe(old.themeId)
      expect(asset.audio).toEqual(old.audio)
      if (replacements.has(asset.assetId)) {
        expect(hash(bytes(asset.imageUrl))).not.toBe(hash(bytes(old.imageUrl)))
        expect(asset.contentVersion).toBe(old.contentVersion + 1)
      } else {
        expect(hash(bytes(asset.imageUrl))).toBe(hash(bytes(old.imageUrl)))
        expect(hash(bytes(asset.thumbnailUrl!))).toBe(hash(bytes(old.thumbnailUrl!)))
        expect(asset.contentVersion).toBe(old.contentVersion)
      }
    }
  })

  it.each(Object.entries(index.assets))('retains %s source PSD, original layer order, bounds, pixels and visibility', (key, pack) => {
    const source = readFileSync('assets/source/provided-psd-20261017/' + pack.source.filename)
    expect(hash(source)).toBe(pack.source.sha256)
    expect(pack.source.sha256).toBe(originalHashes[key])
    const expected = { fuwa: 8, hongbao: 4, jiaozi: 2, denglong: 2, beijing: 8 }
    expect(pack.layers).toHaveLength(expected[key as keyof typeof expected])
    expect(pack.reconstructionMaxChannelError).toBe(0)
    expect(pack.nativeCompositeMaxChannelError).toBeLessThanOrEqual(1)
    expect(hash(bytes(pack.imageUrl))).toBe(pack.imageSha256)
    for (const [i, layer] of pack.layers.entries()) {
      expect(layer.paintOrder).toBe(i)
      expect(layer.sourceBounds).toHaveLength(4)
      const image = bytes(layer.imageUrl)
      expect(hash(image)).toBe(layer.imageSha256)
      expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([pack.width, pack.height])
    }
    const visible = pack.layers.filter(l => l.effectiveVisible)
    expect(hash(bytes(visible.at(-1)!.assemblyUrl!))).toBe(pack.imageSha256)
    if (key === 'hongbao') {
      expect(pack.layers[0].name).toBe('背景')
      expect(pack.layers[0].visible).toBe(false)
      expect(pack.layers[0]).not.toHaveProperty('assemblyUrl')
      expect(visible).toHaveLength(3)
    }
  })

  it('keeps Fuwa separate from the learned sticker set and retains authored layers rather than invented job results', () => {
    expect(catalog.assets.some(a => /fuwa/i.test(a.assetId))).toBe(false)
    expect(index.assets.fuwa.layers).toHaveLength(8)
    for (const asset of catalog.assets.filter(a => a.preSplitDataUrl)) {
      const raw = JSON.parse(bytes(asset.preSplitDataUrl!).toString('utf8'))
      const pack = parseProvidedPsdLayers(raw, asset)
      expect(pack.layers.filter(l => l.effectiveVisible).length).toBe(asset.assetId === 'sticker_red_envelope_001' ? 3 : 2)
      expect(pack.source.sha256).toHaveLength(64)
    }
  })

  it('updates version identities for the replacement media without changing unrelated records', () => {
    for (const asset of catalog.assets.filter(a => replacements.has(a.assetId))) {
      const media = Object.fromEntries([
        ['image', asset.imageUrl], ['thumbnail', asset.thumbnailUrl], ['preSplit', asset.preSplitDataUrl]
      ].filter(([, ref]) => ref).map(([slot, ref]) => [slot, { logicalName: ref!.split('/').at(-1), sha256: hash(bytes(ref!)) }]))
      for (const [slot, field] of [['nameZhAudio', 'nameZhUrl'], ['nameEnAudio', 'nameEnUrl'], ['introZhAudio', 'introZhUrl']] as const) {
        const ref = asset.audio[field]!
        media[slot] = { logicalName: ref.split('/').at(-1), sha256: hash(bytes(ref)) }
      }
      const entry = versions.assets[asset.assetId as keyof typeof versions.assets]
      expect(entry.contentVersion).toBe(asset.contentVersion)
      expect(entry.projection).toEqual(contentProjection(asset as unknown as Record<string, unknown>, media))
    }
  })

  it('rejects layer aliases, reordered layers and accidental enabling of the hidden paper layer', () => {
    const asset = catalog.assets.find(a => a.assetId === 'sticker_red_envelope_001')!
    const raw = JSON.parse(bytes(asset.preSplitDataUrl!).toString('utf8'))
    for (const edit of [
      (x: any) => { x.imageUrl = previous.assets[0].imageUrl },
      (x: any) => { x.layers[1].imageUrl = x.layers[2].imageUrl },
      (x: any) => { x.layers[0].effectiveVisible = true },
      (x: any) => { x.layers.reverse() }
    ]) {
      const changed = structuredClone(raw); edit(changed)
      expect(() => parseProvidedPsdLayers(changed, asset)).toThrow('PSD 原始图层')
    }
  })
})

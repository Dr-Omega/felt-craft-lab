import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sourceMap from '../../docs/material-v2-source-map.json'
import manifest from '../../src/renderer/src/catalog/assets.manifest.json'

describe('material v2 packaged bytes and source identity', () => {
  it('matches every image, thumbnail and audio against the pinned source tree', () => {
    let checked = 0
    for (const asset of manifest.assets) {
      const entries = [asset.imageUrl, asset.thumbnailUrl, ...Object.values(asset.audio)]
      for (const ref of entries) {
        expect(ref).toBeTruthy()
        const relative = ref!.replace('felt-resource://', '')
        const filename = relative.split('/').at(-1)!
        const alias = sourceMap.aliases.find(item => item.assetId === asset.assetId && item.destinationPath.endsWith(`/${filename}`))
        const original = alias?.sourcePath ?? (relative.startsWith('audio/') ? `audio/${filename}`
          : `${asset.themeId}/${filename.endsWith('_thumb.png') ? 'thumbnails' : asset.type === 'background' ? 'backgrounds' : 'stickers'}/${filename}`)
        const entry = sourceMap.sourceFiles.find(item => item.path === original)
        expect(entry, original).toBeTruthy()
        const bytes = readFileSync(resolve('assets/generated', relative))
        expect(bytes.length, original).toBe(entry!.size)
        const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        expect(digest, original).toBe(entry!.blobSha)
        checked++
      }
    }
    expect(checked).toBe(355)
  })
  it('keeps master metadata distinct from the older learning-branch copy', () => {
    expect(manifest.sourcePack).toContain(sourceMap.commit)
    expect(manifest.assets).toHaveLength(sourceMap.readyRows)
    expect(new Set(manifest.assets.map(asset => asset.themeId)).size).toBe(sourceMap.themes)
    expect(manifest.assetSnapshotId).toBe(sourceMap.snapshotId)
  })
})

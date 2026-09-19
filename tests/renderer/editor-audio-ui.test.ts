import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { YWN_ASSETS } from '../../src/renderer/src/catalog/ywn-catalog'

const page = readFileSync(resolve('src/renderer/src/pages/EditorPage.vue'), 'utf8')
const sheet = readFileSync(resolve('src/renderer/src/components/editor/MaterialSheet.vue'), 'utf8')
const drawer = readFileSync(resolve('src/renderer/src/components/editor/BackgroundDrawer.vue'), 'utf8')
const controls = readFileSync(resolve('src/renderer/src/components/editor/AssetAudioControls.vue'), 'utf8')

describe('V4.6 Editor audio controls', () => {
  it('renders only the available Chinese name, English name, and intro actions', () => {
    expect(controls).toContain('if (audio.nameZhUrl)')
    expect(controls).toContain('if (audio.nameEnUrl)')
    expect(controls).toContain('if (audio.introZhUrl)')
    expect(controls).toContain("label: '中文名称'")
    expect(controls).toContain("label: '英文名称'")
    expect(controls).toContain("label: '听介绍'")
    expect(controls).toContain('v-if="audioButtons.length > 0"')
    expect(controls).not.toContain('<audio')
  })

  it('uses the existing primary AudioService without consulting AssetAccess', () => {
    expect(controls).toContain("audioService.play(button.url, 'primary')")
    expect(controls).not.toContain('isAssetUnlocked')
    expect(sheet).toContain('<AssetAudioControls :asset="selectedAsset()" :active="open" />')
    expect(drawer).toContain(':asset="selectedAsset()"')
    expect(drawer).toContain('v-if="selectedAsset()"')
    expect(sheet).toContain(':disabled="busy || !unlocked(selectedAsset()!)"')
    expect(drawer).toContain(':disabled="busy || (selectedAssetId !== \'\' && !unlocked(selectedAsset()!))"')
  })

  it('stops primary playback when either panel closes or Editor unmounts', () => {
    expect(page).toContain("function closeMaterialSheet(): void {")
    expect(page).toContain("function closeBackgroundDrawer(): void {")
    expect(page).toContain("@close=\"closeBackgroundDrawer\"")
    expect(page).toContain("audioService.stop('primary')")
    expect(page).toContain("onUnmounted(() => {")
  })

  it('keeps the formal snapshot audio files available for acceptance targets', () => {
    const targetIds = ['sticker_fu_001', 'sticker_rabbit_001', 'background_lantern_street_001']
    for (const assetId of targetIds) {
      const asset = YWN_ASSETS.find((candidate) => candidate.assetId === assetId)
      expect(asset).toBeDefined()
      expect(asset?.audio.nameZhUrl).toMatch(/^felt-resource:\/\/audio\//)
      expect(asset?.audio.nameEnUrl).toMatch(/^felt-resource:\/\/audio\//)
      expect(asset?.audio.introZhUrl).toMatch(/^felt-resource:\/\/audio\//)
      for (const url of [asset!.audio.nameZhUrl, asset!.audio.nameEnUrl, asset!.audio.introZhUrl]) {
        const relative = url!.slice('felt-resource://audio/'.length)
        expect(existsSync(resolve('assets/generated/audio', relative))).toBe(true)
      }
    }
  })
})

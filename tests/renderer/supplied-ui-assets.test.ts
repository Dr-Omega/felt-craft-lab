import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../../assets/ui/supplied-controls/manifest.json'
import { sourceBox, suppliedRoles } from '../../src/renderer/src/ui/supplied-controls'

describe('supplied UI source identity and positions', () => {
  it('skins supplemental material and creation actions instead of leaving native buttons', () => {
    const read = (file: string) => readFileSync(resolve('src/renderer/src', file), 'utf8')
    expect(read('components/editor/AssetFavoriteButton.vue')).toContain('class="hand-btn-secondary"')
    expect(read('components/editor/AssetAudioControls.vue')).toContain('asset-audio-button hand-btn-secondary')
    const material = read('components/editor/MaterialSheet.vue')
    expect(material).toContain('sheet-add hand-btn-primary')
    expect(material).toContain('class="hand-btn-secondary" type="button" @click="emit(\'ask\'')
    expect(material).not.toContain('完成主题引导后解锁。')
    expect(read('components/editor/BackgroundDrawer.vue')).toContain('background-drawer art-scrollbars')
    const tools = read('pages/EditorPage.vue').split('class="creation-tools-menu"')[1].split('</div>')[0]
    expect(tools.match(/class="hand-btn-primary"/g)).toHaveLength(5)
  })
  it('uses reusable source artwork for role cancel and registration without moving supplied roles', () => {
    const role = readFileSync(resolve('src/renderer/src/components/auth/RoleArtworkPicker.vue'), 'utf8')
    expect(role).toContain('aria-label="返回"')
    expect(role).toContain(':src="handDrawnAssets.btnBack"')
    const login = readFileSync(resolve('src/renderer/src/pages/LoginPage.vue'), 'utf8')
    expect(login).toContain('login-mode-toggle hand-btn-secondary')
    expect(login).not.toContain('login-mode-toggle linkish')
  })
  for (const layer of manifest.layers) it(`preserves original PNG bytes and canvas: ${layer.slug}`, () => {
    const bytes = readFileSync(resolve('assets/ui/supplied-controls', `${layer.slug}.png`))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(layer.sha256)
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1920, 1080])
  })
  it('binds the existing four role values at measured source coordinates', () => {
    expect(suppliedRoles.map(item => [item.value, ...item.bounds])).toEqual([
      ['child',774,440,398,87], ['parent',774,554,398,87],
      ['art_teacher',774,662,398,87], ['chinese_teacher',774,766,398,87]
    ])
    expect(sourceBox(suppliedRoles[0].bounds)).toEqual({position:'absolute',left:'774px',top:'440px',width:'398px',height:'87px'})
  })
  it('uses a single aspect-preserving artboard transform, not independent layer stretch', () => {
    const source = readFileSync(resolve('src/renderer/src/components/artwork/SourceArtboard.vue'),'utf8')
    expect(source).toContain('Math.min(window.innerWidth / 1920, window.innerHeight / 1080)')
    expect(source).toContain('translate(-50%, -50%) scale(')
  })
  it('keeps the guided unlock guard while replacing the question entry', () => {
    const source = readFileSync(resolve('src/renderer/src/pages/LearningZonePage.vue'),'utf8')
    expect(source).toContain('v-if="isUnlocked && questionAsset"')
    expect(source).toContain('bounds="1037 816 182 76"')
    expect(source).toContain('qaAsset = questionAsset')
  })
})

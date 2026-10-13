import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { placeLayerPanel } from '../../src/renderer/src/fabrication/panel-placement'

describe('Element-anchored layer panel', () => {
  it('shows the source while preparing, without presenting nonexistent layers as editable', () => {
    const panel = readFileSync('src/renderer/src/components/projection/LayerEditorPanel.vue', 'utf8')
    const editor = readFileSync('src/renderer/src/components/projection/ElementLayerEditor.vue', 'utf8')
    expect(panel).toContain('v-if="!colors" class="preparation-state"')
    expect(panel).toContain('v-else class="panel-columns"')
    expect(panel).toContain('handDrawnAssets.btnClose')
    expect(panel).toContain('alt="待处理的原图"')
    expect(editor).toContain(':preparing="busy" :source-preview="sourcePreview"')
    expect(editor).toContain('URL.revokeObjectURL(sourcePreview)')
  })
  it('uses free space on the right of a left-side element', () => {
    const p = placeLayerPanel({ left: 100, top: 200, width: 220, height: 300 }, { width: 1440, height: 900 })
    expect(p.side).toBe('right'); expect(p.left).toBeGreaterThan(320)
  })
  it('moves to the left of a right-side element', () => {
    const p = placeLayerPanel({ left: 1080, top: 200, width: 200, height: 300 }, { width: 1440, height: 900 })
    expect(p.side).toBe('left'); expect(p.left + p.width).toBeLessThan(1080)
  })
  it.each([{width:960,height:640},{width:390,height:844},{width:1920,height:1080},{width:800,height:400}])('keeps panel reachable at $width×$height', viewport => {
    for (const left of [0, viewport.width / 2, viewport.width - 20]) {
      const p = placeLayerPanel({ left, top: viewport.height-10, width: 200, height: 300 }, viewport)
      expect(p.left).toBeGreaterThanOrEqual(12); expect(p.top).toBeGreaterThanOrEqual(12)
      expect(p.left+p.width).toBeLessThanOrEqual(viewport.width-12)
      expect(p.top+p.height).toBeLessThanOrEqual(viewport.height-12)
    }
  })
  it('maps edit explicitly; display reversal never mutates canonical order', () => {
    const page = readFileSync('src/renderer/src/pages/EditorPage.vue','utf8')
    const panel = readFileSync('src/renderer/src/components/projection/LayerEditorPanel.vue','utf8')
    expect(page).toContain('@edit="editElementLayers"')
    expect(panel).toContain('[...(props.colors?.layers || [])].reverse()')
    expect(panel).toContain("emit('select', layer.layerIndex)")
    expect(panel).toContain('制作图层列表'); expect(panel).toContain('当前层调色')
  })
  it('opens only the color panel without an isolated artwork workspace or decorative backing', () => {
    const page = readFileSync('src/renderer/src/pages/FabricationPage.vue','utf8')
    expect(page).not.toContain('DismantleWorkspace')
    expect(page).not.toMatch(/background-0[234]/)
    expect(page).toContain('<LayerEditorPanel')
    const editor = readFileSync('src/renderer/src/pages/EditorPage.vue','utf8')
    expect(editor).toContain('@preview="previewLayerColor"')
    expect(editor).toContain('session.value?.clearElementPreview()')
  })
})

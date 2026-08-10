import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const page = readFileSync(resolve('src/renderer/src/pages/EditorPage.vue'), 'utf8')
const topbar = readFileSync(resolve('src/renderer/src/components/editor/EditorTopbar.vue'), 'utf8')
const drawer = readFileSync(resolve('src/renderer/src/components/editor/BackgroundDrawer.vue'), 'utf8')
const sheet = readFileSync(resolve('src/renderer/src/components/editor/MaterialSheet.vue'), 'utf8')
const dock = readFileSync(resolve('src/renderer/src/components/editor/BottomActionDock.vue'), 'utf8')
const modal = readFileSync(resolve('src/renderer/src/components/editor/ReturnSaveModal.vue'), 'utf8')

describe('V4.6 formal Editor UI contract', () => {
  it('keeps the production template free of engineering side-panel copy', () => {
    const template = page.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
    const renderedText = template.replace(/<[^>]+>/g, ' ')
    for (const forbidden of ['Scene.assetSnapshotId', 'addSticker', 'setBackground', 'prepareProject', 'prepareDraft', 'pending', 'local_only', 'syncStatus', '测试解锁']) {
      expect(renderedText).not.toContain(forbidden)
    }
    expect(topbar).toContain('完成啦')
    expect(sheet).toContain('放进作品')
    expect(modal).toContain('要先把作品收起来吗？')
  })

  it('preserves canonical logical Canvas and responsive display formula', () => {
    expect(page).toContain(':width="logicalCanvasWidth"')
    expect(page).toContain(':height="logicalCanvasHeight"')
    expect(page).toContain('min(66vw, calc(100vh - 180px), 760px)')
    expect(page).toContain('width: 100% !important')
    expect(page).toContain('height: 100% !important')
  })

  it('defines the frozen V4.6 visual tokens and geometry layers', () => {
    for (const token of ['#f8f0e2', '#f0e2c5', '#efe2c9', '#d9b98a', '#a88b6c', '#7e6244', '#e8a572', '#f4c9a4', '#9caf88', '#594738']) {
      expect(page).toContain(token)
    }
    expect(page).toContain('.editor-topbar')
    expect(page).toContain('.canvas-frame')
    expect(page).toContain('.background-trigger')
    expect(page).toContain('.bottom-action-dock')
    expect(page).toContain('.material-sheet')
  })

  it('maps visible UI actions to the existing session and persistence boundaries', () => {
    expect(page).toContain('session.value.addSticker(asset, access)')
    expect(page).toContain('session.value.setBackground(null)')
    expect(page).toContain('session.value.undo()')
    expect(page).toContain('session.value.redo()')
    expect(page).toContain('session.value.prepareProjectSave()')
    expect(page).toContain('session.value.prepareDraftSave()')
    expect(page).toContain('saveDraftFromPreparedScene')
  })

  it('keeps locked assets visible and makes add/apply two-step actions explicit', () => {
    expect(sheet).toContain("'is-locked'")
    expect(sheet).toContain('放进作品')
    expect(drawer).toContain('换成这个背景')
    expect(drawer).toContain('空白纸')
    expect(drawer).toContain("'is-locked'")
  })

  it('keeps the Material Sheet candidate empty until an explicit user selection', () => {
    expect(page).toContain("const selectedStickerId = ref('')")
    expect(page).not.toContain('normalizeSelectedAssetId(selectedStickerId.value, stickers.value)')
    expect(page).toContain('function closeMaterialSheet()')
    expect(page).toContain('function openMaterialSheet()')
    expect(page).toContain('selectedStickerId.value = \'\'')
    expect(page).toContain('@close="closeMaterialSheet"')
  })

  it('provides accessible icon-only controls and the return fallback choices', () => {
    expect(topbar).toContain('aria-label="返回素材库"')
    expect(topbar).toContain('aria-label="返回素材库"')
    expect(dock).toContain('aria-label="撤销"')
    expect(dock).toContain('aria-label="打开素材盒"')
    expect(dock).toContain('aria-label="重做"')
    expect(modal).toContain('保存进度再回去')
    expect(modal).toContain('直接回去')
    expect(modal).toContain('继续做')
  })

  it('keeps category chips to the real available contract surface', () => {
    expect(sheet).toContain('全部')
    for (const placeholder of ['动物', '植物', '房屋', '装饰', '天空', 'Demo', 'Placeholder']) {
      expect(sheet).not.toContain(placeholder)
    }
  })
})

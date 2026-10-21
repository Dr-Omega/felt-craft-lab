import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read = (file: string) => readFileSync(`src/renderer/src/${file}`, 'utf8')
describe('approved UI route consolidation', () => {
  it('does not mount the old shell, library or standalone creation page', () => {
    const app = read('App.vue')
    for (const name of ['AppShell', 'LibraryPage', 'CreateAssetPage', 'utility-nav', 'integration-content']) expect(app).not.toContain(name)
    expect(app).toContain('<PersonalCenterPage')
  })
  it('keeps save/discard protection before returning from the canvas', () => {
    const editor = read('pages/EditorPage.vue')
    for (const operation of ['returnFromEditor()', 'saveProgressAndBack', 'discardAndBack', 'returnModalOpen.value = true']) expect(editor).toContain(operation)
  })
  it('retains old work and material capabilities at the new entry points', () => {
    const profile = read('pages/PersonalCenterPage.vue')
    for (const feature of ['deleteExistingProject', 'DraftStore', "'story-card'", "'work-export'", 'returnFilter: filter.value', '确定删除']) expect(profile).toContain(feature)
    // The old display entry was explicitly hidden; direct paper export remains available.
    expect(profile).not.toContain('查看图层展示')
    for (const surface of ['MaterialSheet', 'BackgroundDrawer']) expect(read(`components/editor/${surface}.vue`)).toContain('<AssetFavoriteButton')
  })
})

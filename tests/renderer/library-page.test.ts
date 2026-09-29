import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const library = readFileSync(resolve('src/renderer/src/pages/LibraryPage.vue'), 'utf8')
const libraryTemplate = library.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
const libraryScript = library.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
const libraryRendered = libraryTemplate.replace(/<[^>]+>/g, ' ')
const previewModal = readFileSync(resolve('src/renderer/src/components/library/ProjectPreviewModal.vue'), 'utf8')

describe('V4.6 Phase 1 Library 我的创作 surface', () => {
  it('re-exposes a friendly creation section with new-work, drafts, and projects', () => {
    expect(library).toContain('我的创作')
    expect(library).toContain('继续制作')
    expect(library).toContain('我的作品')
    expect(library).toContain('素材库')
  })

  it('allows the default all-themes selection to create a work without an acceptance gate', () => {
    expect(library).not.toContain('VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR')
    expect(library).not.toContain('allowAllThemes')
    expect(library).toContain('<option value="all">全部</option>')
    expect(library).toContain('prepareNewWorkScene(newWorkName.value, themeFilter.value)')
  })

  it('uses the friendly-time helper for the user-facing updated copy', () => {
    expect(libraryScript).toContain('friendlyRelativeTime')
    expect(libraryScript).toContain("from '../util/friendly-time'")
  })

  it('does not leak persistence engineering fields to children', () => {
    const lowerRendered = libraryRendered.toLowerCase()
    for (const forbidden of [
      'draftid',
      'projectid',
      'assetsnapshotid',
      'syncstatus',
      'local_only',
      'iso 原始',
      '数据库'
    ]) {
      expect(lowerRendered).not.toContain(forbidden)
    }
    // ISO timestamps must not appear inside the rendered library template
    // (only as values inside the data layer script).
    expect(libraryTemplate).not.toMatch(/updatedAt.*\d{4}-\d{2}-\d{2}T/)
  })

  it('wires draft open and delete actions to existing persistence APIs', () => {
    expect(library).toContain('openEditor({ mode: \'draft\', scene: draft.scene, draftId: draft.draftId })')
    expect(libraryScript).toContain('DraftStore')
    expect(libraryScript).toContain('new DraftStore(getFeltCraftDatabase()).delete(target.record.draftId)')
  })

  it('wires project open, preview, and delete actions to existing persistence APIs', () => {
    expect(library).toContain('openEditor({ mode: \'project\', scene: project.scene, projectId: project.projectId })')
    expect(libraryScript).toContain('deleteExistingProject')
    expect(library).toContain('project.previewUrl')
  })

  it('shows empty states for both drafts and projects', () => {
    expect(library).toContain('还没有草稿，新建一件作品开始吧。')
    expect(library).toContain('还没有作品，完成第一件吧。')
  })

  it('renders the ProjectPreviewModal as a Library-internal large-image modal', () => {
    expect(previewModal).toContain('role="dialog"')
    expect(previewModal).toContain('aria-modal="true"')
    expect(previewModal).toContain(':src="project.previewUrl"')
    expect(previewModal).toContain("emit('close')")
    expect(library).toContain('import ProjectPreviewModal from \'../components/library/ProjectPreviewModal.vue\'')
    expect(library).toContain('@close="closeProjectPreview"')
    expect(library).toContain('@open="openProjectFromPreview"')
  })

  it('routes the Library scroll container inside the page so Editor overflow cannot leak', () => {
    expect(library).toContain('.library-scroll')
    expect(library).toContain('overflow-y: auto')
  })

  it('keeps delete confirmations explicit and never deletes immediately on a single click', () => {
    expect(library).toContain('askRemoveDraft')
    expect(library).toContain('askRemoveProject')
    expect(library).toContain('confirmDelete')
    expect(library).toContain('确定要删掉这个草稿吗？')
    expect(library).toContain('确定要删掉这件作品吗？')
    expect(library).toContain('确定删除')
  })

  it('keeps test unlock local-only and explicitly opt-in in preview builds', () => {
    expect(libraryScript).toContain("new URLSearchParams(window.location.search).get('testUnlock') === '1'")
    expect(libraryScript).toContain("window.location.hostname === 'localhost'")
    expect(libraryScript).toContain("window.location.hostname === '127.0.0.1'")
    expect(libraryScript).toContain('import.meta.env.DEV || (localPreviewHost && testUnlockRequested)')
    expect(library).toContain('v-if="allowTestUnlock && !unlockedIds.has(asset.assetId)"')
    expect(libraryScript).toContain('if (!allowTestUnlock) return')
  })
})

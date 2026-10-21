import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { StoryCardWorkContext } from '../../src/shared/contracts'
import { validFeltProject } from '../persistence/fixtures'
const mocks = vi.hoisted(() => ({ load: vi.fn(), context: vi.fn() }))
vi.mock('../../src/renderer/src/services/plaza-session', () => ({
  loadPlazaSession: () => ({ token: 'test', user: { userId: 'user_demo_001' } }),
  getCurrentUserId: () => 'user_demo_001',
  clearPlazaSession: vi.fn()
}))
vi.mock('../../src/renderer/src/workflows/saved-work', () => ({
  loadSavedWork: mocks.load, savedWorkStoryContext: mocks.context
}))
import { continueStoryToExplode, getWorkDisplayEntry, getAppView, getEditorLaunch, getStoryCardContext, openEditor, openLibrary, openSavedWork, returnFromSavedWork } from '../../src/renderer/src/app-nav'
const context: StoryCardWorkContext = { workId: 'work', completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/work.png', background: null, subject: { name: '作品' }, stickers: [] }
afterEach(() => { openLibrary(); vi.clearAllMocks() })
describe('saved work navigation', () => {
  it('opens the export surface directly from personal works and returns there without forcing a story page', async () => {
    mocks.load.mockResolvedValue(validFeltProject())
    await openSavedWork(validFeltProject().projectId, 'work-export', 'profile')
    expect(getAppView()).toBe('work-display'); expect(getWorkDisplayEntry()).toBe('export')
    expect(mocks.context).not.toHaveBeenCalled()
    await returnFromSavedWork()
    expect(getAppView()).toBe('profile')
  })
  it('continues from story directly to explosion and returns through story to the saved editor', async () => {
    const work = validFeltProject()
    mocks.load.mockResolvedValue(work); mocks.context.mockResolvedValue(context)
    await openSavedWork(work.projectId, 'story-card', 'editor')
    await continueStoryToExplode(work.projectId)
    expect(getAppView()).toBe('work-display')
    expect(getWorkDisplayEntry()).toBe('explode')
    await returnFromSavedWork()
    expect(getAppView()).toBe('story-card')
    await returnFromSavedWork()
    expect(getAppView()).toBe('editor')
    await openSavedWork(work.projectId, 'work-display', 'profile')
    expect(getWorkDisplayEntry()).toBe('picture')
    await returnFromSavedWork()
    expect(getAppView()).toBe('profile')
  })
  it('does not advance a missing or different story work', async () => {
    const work = validFeltProject()
    mocks.load.mockResolvedValue(work); mocks.context.mockResolvedValue(context)
    await openSavedWork(work.projectId, 'story-card', 'profile')
    await expect(continueStoryToExplode('other')).rejects.toThrow()
    mocks.load.mockRejectedValue(new Error('missing'))
    await expect(continueStoryToExplode(work.projectId)).rejects.toThrow('missing')
    expect(getAppView()).toBe('story-card')
  })
  it('opens Vue-proxied library rows without mutating the saved scene', () => {
    const work = reactive(validFeltProject())
    openEditor({ mode: 'project', projectId: work.projectId, scene: work.scene })
    expect(getEditorLaunch()?.scene).toEqual(work.scene)
    getEditorLaunch()!.scene.workName = 'changed in editor'
    expect(work.scene.workName).not.toBe('changed in editor')
  })
  it('loads by ID before opening story and returns to the saved editor, not a stale launch', async () => {
    const work = validFeltProject()
    mocks.load.mockResolvedValue(work); mocks.context.mockResolvedValue(context)
    await openSavedWork(work.projectId, 'story-card', 'editor')
    expect(mocks.load).toHaveBeenCalledWith(work.projectId)
    expect(getAppView()).toBe('story-card')
    expect(getStoryCardContext()).toEqual(context)
    await returnFromSavedWork()
    expect(getAppView()).toBe('editor')
    expect(getEditorLaunch()?.scene).toEqual(work.scene)
  })
  it('missing work leaves the current view intact', async () => {
    openLibrary(); mocks.load.mockRejectedValue(new Error('missing'))
    await expect(openSavedWork('missing', 'work-display')).rejects.toThrow('missing')
    expect(getAppView()).toBe('profile')
  })
  it('ignores late work loads after another navigation', async () => {
    let finish!: (work: ReturnType<typeof validFeltProject>) => void
    mocks.load.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const navigation = openSavedWork('slow', 'work-display')
    openLibrary(); finish(validFeltProject()); await navigation
    expect(getAppView()).toBe('profile')
  })
})

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
import { getAppView, getEditorLaunch, getStoryCardContext, openEditor, openLibrary, openSavedWork, returnFromSavedWork } from '../../src/renderer/src/app-nav'
const context: StoryCardWorkContext = { workId: 'work', completionStatus: 'completed',
  artworkImageRef: 'felt-resource://preview/work.png', background: null, subject: { name: '作品' }, stickers: [] }
afterEach(() => { openLibrary(); vi.clearAllMocks() })
describe('saved work navigation', () => {
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
    expect(getAppView()).toBe('library')
  })
  it('ignores late work loads after another navigation', async () => {
    let finish!: (work: ReturnType<typeof validFeltProject>) => void
    mocks.load.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const navigation = openSavedWork('slow', 'work-display')
    openLibrary(); finish(validFeltProject()); await navigation
    expect(getAppView()).toBe('library')
  })
})

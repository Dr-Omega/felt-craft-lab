import type { ProjectRecord, SceneDocument, StoryCardWorkContext } from '@shared/contracts'
import { loadSavedWork, savedWorkStoryContext } from './workflows/saved-work'
import type { SceneBinding } from '@shared/fabrication-colors'
import { clearPlazaSession, getCurrentUserId, loadPlazaSession } from './services/plaza-session'

export type AppView = 'splash' | 'login' | 'lobby' | 'profile' | 'plaza' | 'rewards' | 'library' | 'learning' | 'editor' | 'status' | 'create' | 'fabrication' | 'story-card' | 'work-display'
export type MainAppView = 'library' | 'editor' | 'projection'

let fabricationInput: { bytes: Uint8Array; name: string; binding?: SceneBinding } | undefined
export function takeFabricationInput(): typeof fabricationInput {
  const input = fabricationInput
  fabricationInput = undefined
  return input
}
export function openFabrication(input?: { bytes: Uint8Array; name: string; binding?: SceneBinding }): void {
  navigationGeneration++
  fabricationInput = input
  currentView = 'fabrication'
  notify()
}

export type EditorLaunchMode = 'new' | 'draft' | 'project'

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
  /** Starts processing the accepted personal image; never grants theme permissions. */
  fromGeneration?: boolean
  /** Separate task scene; never persisted as a free-creation work. */
  guidedTheme?: { sessionId: string; themeId: string }
}

let currentView: AppView = 'splash'
let launch: EditorLaunchContext | undefined
let savedWork: ProjectRecord | undefined
let storyContext: StoryCardWorkContext | undefined
let workReturn: 'library' | 'editor' | 'profile' = 'library'
let navigationGeneration = 0
const listeners = new Set<() => void>()

function notify(): void {
  if (!['splash', 'login'].includes(currentView) && !loadPlazaSession()) currentView = 'login'
  for (const listener of listeners) listener()
}

function openAccountPage(view: AppView): void {
  navigationGeneration++
  launch = undefined
  currentView = view
  notify()
}
export function openLogin(): void { openAccountPage('login') }
export function completeLogin(): void { openAccountPage('lobby') }
export function openLobby(): void { openAccountPage('lobby') }
export function openPlaza(): void { openAccountPage('plaza') }
export function openPersonalCenter(): void { openAccountPage('profile') }
export function openRewards(): void { openAccountPage('rewards') }
/** Both creation entrances use the same explicit theme/work picker. */
export function enterCreationStudio(): void { openLibrary() }
export async function logout(): Promise<void> {
  await window.electronAPI.plaza.logout()
  clearPlazaSession()
  savedWork = undefined; storyContext = undefined; fabricationInput = undefined
  openLogin()
}

export function getAppView(): AppView {
  return currentView
}

export function getEditorLaunch(): EditorLaunchContext | undefined {
  return launch
}

export function subscribeAppNav(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function openLibrary(): void {
  navigationGeneration++
  launch = undefined
  currentView = 'library'
  notify()
}

let learningThemeId: string | undefined
export function getLearningThemeId(): string | undefined { return learningThemeId }

export function openLearning(themeId?: string): void {
  learningThemeId = themeId
  if (launch?.guidedTheme) launch = undefined
  navigationGeneration++
  currentView = 'learning'
  notify()
}

export function openStatus(): void {
  navigationGeneration++
  currentView = 'status'
  notify()
}

export function openCreate(): void {
  navigationGeneration++
  currentView = 'create'
  notify()
}

export function openEditor(context: EditorLaunchContext): void {
  if (context.scene.userId !== getCurrentUserId()) throw new Error('此作品不属于当前账号。')
  navigationGeneration++
  // Library rows are Vue proxies; scene contracts are JSON, not cloneable proxies.
  launch = JSON.parse(JSON.stringify(context)) as EditorLaunchContext
  currentView = 'editor'
  notify()
}

export function getSavedWork(): ProjectRecord | undefined { return savedWork }
export function getStoryCardContext(): StoryCardWorkContext | undefined { return storyContext }

/** Load first, navigate only after success. Missing/deleted work never opens a stale page. */
export async function openSavedWork(
  projectId: string, target: 'story-card' | 'work-display', back: 'library' | 'editor' | 'profile' = 'library'
): Promise<void> {
  const generation = ++navigationGeneration
  const work = await loadSavedWork(projectId)
  const context = target === 'story-card' ? await savedWorkStoryContext(work) : undefined
  if (generation !== navigationGeneration) return
  savedWork = work
  storyContext = context
  workReturn = back
  currentView = target
  notify()
}

export async function returnFromSavedWork(): Promise<void> {
  if (workReturn === 'editor' && savedWork) {
    const work = await loadSavedWork(savedWork.projectId)
    openEditor({ mode: 'project', projectId: work.projectId, scene: work.scene })
  } else if (workReturn === 'profile') openPersonalCenter()
  else openLibrary()
}

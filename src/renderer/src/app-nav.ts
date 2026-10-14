import type { ProjectRecord, SceneDocument, StoryCardWorkContext } from '@shared/contracts'
import { loadSavedWork, savedWorkStoryContext } from './workflows/saved-work'
import type { SceneBinding } from '@shared/fabrication-colors'
import { clearPlazaSession, getCurrentUserId, loadPlazaSession } from './services/plaza-session'
import { createBlankScene } from './catalog/ywn-catalog'

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
export type PersonalWorksFilter = 'draft' | 'drawing' | 'story' | 'blueprint' | 'completed'
export type PersonalSection = 'account' | 'works' | 'inbox' | 'store'
let personalSection: PersonalSection = 'account'
export function getPersonalSection(): PersonalSection { return personalSection }
let personalWorksFilter: PersonalWorksFilter = 'completed'
export function getPersonalWorksFilter(): PersonalWorksFilter { return personalWorksFilter }
export function setPersonalWorksFilter(filter: PersonalWorksFilter): void { personalWorksFilter = filter }
export function openPersonalWorks(filter: PersonalWorksFilter = personalWorksFilter): void {
  personalSection = 'works'
  personalWorksFilter = filter
  openAccountPage('profile')
}

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
  returnTo?: 'lobby' | 'profile'
  returnFilter?: PersonalWorksFilter
  /** Starts processing the accepted personal image; never grants theme permissions. */
  fromGeneration?: boolean
  /** Open the image chooser only for a fresh lobby creation, never a restored work. */
  chooseImage?: boolean
  /** Separate task scene; never persisted as a free-creation work. */
  guidedTheme?: { sessionId: string; themeId: string }
}

let currentView: AppView = 'splash'
let launch: EditorLaunchContext | undefined
let savedWork: ProjectRecord | undefined
let storyContext: StoryCardWorkContext | undefined
let workReturn: 'library' | 'editor' | 'profile' = 'library'
let workDisplayEntry: 'picture' | 'explode' = 'picture'
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
export function openPersonalCenter(): void {
  personalSection = 'account'
  openAccountPage('profile')
}
export type RewardEntry = 'account' | 'inbox' | 'store' | 'bear'
let rewardEntry: RewardEntry = 'account'
export function getRewardEntry(): RewardEntry { return rewardEntry }
export function openRewards(entry: RewardEntry = 'account'): void { rewardEntry = entry; openAccountPage('rewards') }
/** Personal uploads do not grant access to any locked catalog theme. */
export function enterCreationStudio(): void {
  if (!loadPlazaSession()) { openLogin(); return }
  openEditor({ mode: 'new', scene: createBlankScene('我的新作品'), chooseImage: true, returnTo: 'lobby' })
}
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
  // Compatibility for old callers: never reopen the retired mixed library UI.
  openPersonalWorks()
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
  enterCreationStudio()
}

/** Called only after the editor's save/discard guard has finished. */
export function returnFromEditor(): void {
  const context = launch
  if (context?.guidedTheme) { openLearning(context.guidedTheme.themeId); return }
  if (context?.returnTo === 'profile' || (context?.returnTo !== 'lobby' && context?.mode !== 'new')) {
    openPersonalWorks(context?.returnFilter ?? (context?.mode === 'draft' ? 'draft' : 'drawing'))
  } else openLobby()
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
export function getWorkDisplayEntry(): 'picture' | 'explode' { return workDisplayEntry }

/** Load first, navigate only after success. Missing/deleted work never opens a stale page. */
export async function openSavedWork(
  projectId: string, target: 'story-card' | 'work-display' | 'work-explode', back: 'library' | 'editor' | 'profile' = 'library'
): Promise<void> {
  const generation = ++navigationGeneration
  const work = await loadSavedWork(projectId)
  const context = target === 'story-card' ? await savedWorkStoryContext(work) : undefined
  if (generation !== navigationGeneration) return
  savedWork = work
  storyContext = context
  workReturn = back
  workDisplayEntry = target === 'work-explode' ? 'explode' : 'picture'
  currentView = target === 'work-explode' ? 'work-display' : target
  notify()
}

export async function continueStoryToExplode(workId: string): Promise<void> {
  if (currentView !== 'story-card' || savedWork?.projectId !== workId) throw new Error('请从当前作品的故事卡继续。')
  await openSavedWork(workId, 'work-explode', workReturn)
}

export async function returnFromSavedWork(): Promise<void> {
  if (currentView === 'work-display' && workDisplayEntry === 'explode' && savedWork) {
    await openSavedWork(savedWork.projectId, 'story-card', workReturn)
    return
  }
  if (workReturn === 'editor' && savedWork) {
    const work = await loadSavedWork(savedWork.projectId)
    openEditor({ mode: 'project', projectId: work.projectId, scene: work.scene,
      returnTo: launch?.returnTo, returnFilter: launch?.returnFilter })
  } else if (workReturn === 'profile') openPersonalWorks()
  else openLibrary()
}

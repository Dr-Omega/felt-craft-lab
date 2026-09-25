import type { SceneDocument, StoryCardWorkContext } from '@shared/contracts'

export type AppView = 'library' | 'editor' | 'status' | 'story-card-test' | 'learning-zone-test'

export type EditorLaunchMode = 'new' | 'draft' | 'project'

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
}

let currentView: AppView = 'library'
let launch: EditorLaunchContext | undefined
let storyCardTestContext: StoryCardWorkContext | undefined
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function getAppView(): AppView {
  return currentView
}

export function getEditorLaunch(): EditorLaunchContext | undefined {
  return launch
}

export function getStoryCardTestContext(): StoryCardWorkContext | undefined {
  return storyCardTestContext
}

export function subscribeAppNav(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function openLibrary(): void {
  currentView = 'library'
  notify()
}

export function openStatus(): void {
  currentView = 'status'
  notify()
}
export function openStoryCardTest(context?: StoryCardWorkContext): void {
  storyCardTestContext = context
  currentView = 'story-card-test'
  notify()
}

export function openLearningZoneTest(): void {
  currentView = 'learning-zone-test'
  notify()
}

export function openEditor(context: EditorLaunchContext): void {
  launch = context
  currentView = 'editor'
  notify()
}

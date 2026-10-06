import type { SceneDocument, StoryCardWorkContext } from '@shared/contracts'

export type AppView = 'library' | 'editor' | 'status' | 'story-card-test' | 'learning-zone'

export type EditorLaunchMode = 'new' | 'draft' | 'project'

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
}

const initialView = new URLSearchParams(window.location.search).get('view')
let currentView: AppView = initialView === 'learning-zone' ? 'learning-zone' : 'library'
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

export function openLearningZone(): void {
  currentView = 'learning-zone'
  notify()
}

export function openEditor(context: EditorLaunchContext): void {
  launch = context
  currentView = 'editor'
  notify()
}

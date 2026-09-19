import type { SceneDocument } from '@shared/contracts'

export type AppView = 'library' | 'editor' | 'status'

export type EditorLaunchMode = 'new' | 'draft' | 'project'

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
}

let currentView: AppView = 'library'
let launch: EditorLaunchContext | undefined
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

export function openEditor(context: EditorLaunchContext): void {
  launch = context
  currentView = 'editor'
  notify()
}

import type { SceneDocument } from '@shared/contracts'

export type AppView = 'library' | 'editor' | 'status' | 'create'

export type EditorLaunchMode = 'new' | 'draft' | 'project'

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
  /** True when opened from「生成作品」so the editor can unlock that theme's stickers. */
  fromGeneration?: boolean
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

export function openCreate(): void {
  currentView = 'create'
  notify()
}

export function openEditor(context: EditorLaunchContext): void {
  launch = context
  currentView = 'editor'
  notify()
}

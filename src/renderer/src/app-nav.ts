import type { SceneDocument } from '@shared/contracts'
import { ALL_THEMES_ID } from './catalog/ywn-catalog'
import { prepareNewWorkScene } from './catalog/library-new-work'

export type AppView = 'library' | 'editor' | 'projection'

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

export function openProjection(): void {
  currentView = 'projection'
  notify()
}

export function openEditor(context: EditorLaunchContext): void {
  launch = context
  currentView = 'editor'
  notify()
}

/** Open the canvas page, bootstrapping a blank scene when none exists yet. */
export function openEditorCanvas(): void {
  if (!launch) {
    const prepared = prepareNewWorkScene('我的新作品', ALL_THEMES_ID)
    if (prepared.scene) {
      launch = { mode: 'new', scene: prepared.scene }
    }
  }
  currentView = 'editor'
  notify()
}

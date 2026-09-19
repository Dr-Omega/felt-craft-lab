import type { SceneDocument } from '@shared/contracts'
import { ALL_THEMES_ID } from './catalog/ywn-catalog'
import { prepareNewWorkScene } from './catalog/library-new-work'

export type AppView = 'splash' | 'login' | 'library' | 'editor' | 'projection' | 'status'

/** Views rendered inside the main three-page shell after login. */
export type MainAppView = 'library' | 'editor' | 'projection'

export type EditorLaunchMode = 'new' | 'draft' | 'project'

export interface EditorLaunchContext {
  mode: EditorLaunchMode
  scene: SceneDocument
  draftId?: string
  projectId?: string
}

export interface ProjectionLaunchContext {
  scene: SceneDocument
  sourceLabel?: string
}

let currentView: AppView = 'splash'
let launch: EditorLaunchContext | undefined
let projectionLaunch: ProjectionLaunchContext | undefined
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

export function getProjectionLaunch(): ProjectionLaunchContext | undefined {
  return projectionLaunch
}

export function subscribeAppNav(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function openSplash(): void {
  currentView = 'splash'
  notify()
}

export function openLogin(): void {
  currentView = 'login'
  notify()
}

/** Enter the main app after login. */
export function completeLogin(): void {
  currentView = 'library'
  notify()
}

export function openLibrary(): void {
  currentView = 'library'
  notify()
}

export function openProjection(): void {
  currentView = 'projection'
  notify()
}

/** Engineering / bootstrap diagnostics — not part of the three-bear shell. */
export function openStatus(): void {
  currentView = 'status'
  notify()
}

export function openProjectionWithScene(context: ProjectionLaunchContext): void {
  projectionLaunch = context
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

export function isMainAppView(view: AppView): view is MainAppView {
  return view === 'library' || view === 'editor' || view === 'projection'
}

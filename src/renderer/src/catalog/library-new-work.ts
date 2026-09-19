import type { SceneDocument } from '@shared/contracts'
import { createBlankScene } from './ywn-catalog'

export const CHOOSE_WORK_THEME_MESSAGE = '请先选择作品主题'
export const ACCEPTANCE_ALL_THEMES_IN_EDITOR_ENV = 'VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR'

export interface PrepareNewWorkSceneOptions {
  /** Acceptance-only escape hatch; never persists `all` as SceneDocument.themeId. */
  allowAllThemes?: boolean
}

export type NewWorkSceneSelection =
  | { scene: SceneDocument; message?: undefined }
  | { scene?: undefined; message: typeof CHOOSE_WORK_THEME_MESSAGE }

export function isAcceptanceAllThemesInEditorEnabled(value: unknown): boolean {
  return value === 'true'
}

export function prepareNewWorkScene(
  workName: string,
  themeFilter: string,
  options: PrepareNewWorkSceneOptions = {}
): NewWorkSceneSelection {
  if (themeFilter === 'all' && options.allowAllThemes !== true) {
    return { message: CHOOSE_WORK_THEME_MESSAGE }
  }

  // `all` is a Library filter, not a persisted SceneDocument theme. In the
  // acceptance path createBlankScene chooses the first valid catalog theme,
  // while Editor selection still reads every asset in the Scene snapshot.
  return {
    scene: createBlankScene(workName, themeFilter === 'all' ? undefined : themeFilter)
  }
}

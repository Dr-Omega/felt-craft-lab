import type { SceneDocument } from '@shared/contracts'
import { ALL_THEMES_ID, createBlankScene, listCatalogThemes } from './ywn-catalog'

/**
 * "all" is a formal, first-class theme filter for the new-work flow.
 * The child can choose to draw from every available theme at once; that
 * choice is persisted as SceneDocument.themeId === ALL_THEMES_ID and the
 * Editor keeps every theme's assets reachable.
 */
export const CHOOSE_WORK_THEME_MESSAGE = '请先选择作品主题'

export type NewWorkSceneSelection =
  | { scene: SceneDocument; message?: undefined }
  | { scene?: undefined; message: typeof CHOOSE_WORK_THEME_MESSAGE }

/**
 * Normalize the Library's theme filter into a SceneDocument.themeId. The
 * "all" filter is kept literally; a missing or otherwise invalid id is
 * replaced by the first valid catalog theme so the Scene still boots.
 * An empty (whitespace-only) id, in contrast, is a hard user error and
 * surfaces the friendly "请先选择作品主题" message.
 */
export function prepareNewWorkScene(
  workName: string,
  themeFilter: string
): NewWorkSceneSelection {
  const trimmed = (themeFilter ?? '').trim()
  if (trimmed.length === 0) {
    return { message: CHOOSE_WORK_THEME_MESSAGE }
  }
  let sceneThemeId: string
  if (trimmed === ALL_THEMES_ID) {
    sceneThemeId = ALL_THEMES_ID
  } else {
    const knownThemeIds = new Set(listCatalogThemes())
    if (!knownThemeIds.has(trimmed)) {
      // Unknown theme id (e.g. a legacy snapshot referenced a removed
      // theme). Fall back to the first valid theme so the Scene still
      // boots instead of silently breaking the new-work flow.
      sceneThemeId = listCatalogThemes()[0] ?? trimmed
    } else {
      sceneThemeId = trimmed
    }
  }
  return {
    scene: createBlankScene(workName, sceneThemeId)
  }
}


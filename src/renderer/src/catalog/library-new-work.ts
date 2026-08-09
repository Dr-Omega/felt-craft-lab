import type { SceneDocument } from '@shared/contracts'
import { createBlankScene } from './ywn-catalog'

export const CHOOSE_WORK_THEME_MESSAGE = '请先选择作品主题'

export type NewWorkSceneSelection =
  | { scene: SceneDocument; message?: undefined }
  | { scene?: undefined; message: typeof CHOOSE_WORK_THEME_MESSAGE }

export function prepareNewWorkScene(workName: string, themeFilter: string): NewWorkSceneSelection {
  if (themeFilter === 'all') {
    return { message: CHOOSE_WORK_THEME_MESSAGE }
  }
  return { scene: createBlankScene(workName, themeFilter) }
}

import type { SceneCanvas } from './contracts/scene'

/** Older blank scenes persisted the editor's paper surface as artwork. */
export const LEGACY_UI_PAPER_COLOR = '#FFF8E7'

/** UI paper is never an artwork layer, even when a scene image is selected. */
export function artworkBackgroundColor(canvas: SceneCanvas): string | undefined {
  const color = canvas.backgroundColor
  if (canvas.backgroundColorSource !== 'user' && color?.trim().toUpperCase() === LEGACY_UI_PAPER_COLOR) return undefined
  return color
}

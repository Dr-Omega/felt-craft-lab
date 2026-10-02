/**
 * Measured from assets/ui/drawing/board.png on the 1920×1080 drawing artboard.
 * The cream paper fill is the interactive canvas target — not a square 1:1 slot.
 */
export const DRAWING_ARTBOARD = {
  width: 1920,
  height: 1080
} as const

export const DRAWING_BOARD_PAPER_BBOX = {
  left: 314,
  top: 114,
  width: 1302,
  height: 858
} as const

export const DEFAULT_DRAWING_SCENE_CANVAS = {
  width: DRAWING_BOARD_PAPER_BBOX.width,
  height: DRAWING_BOARD_PAPER_BBOX.height
} as const

export function drawingPaperLayoutStyle(): {
  left: string
  top: string
  width: string
  height: string
} {
  const { left, top, width, height } = DRAWING_BOARD_PAPER_BBOX
  const { width: artboardWidth, height: artboardHeight } = DRAWING_ARTBOARD
  return {
    left: `${(left / artboardWidth) * 100}%`,
    top: `${(top / artboardHeight) * 100}%`,
    width: `${(width / artboardWidth) * 100}%`,
    height: `${(height / artboardHeight) * 100}%`
  }
}

import manifest from '../../../../assets/ui/psd160/manifest.json'
import backgroundUrl from '../../../../assets/ui/psd160/background.png'
import backgroundDecorUrl from '../../../../assets/ui/psd160/background-decor.png'
import foxButtonUrl from '../../../../assets/ui/psd160/fox-button.png'
import whiteBearButtonUrl from '../../../../assets/ui/psd160/white-bear-button.png'
import brownBearButtonUrl from '../../../../assets/ui/psd160/brown-bear-button.png'
import bookUrl from '../../../../assets/ui/psd160/book.png'
import canvasFrameUrl from '../../../../assets/ui/psd160/canvas-frame.png'
import saveButtonUrl from '../../../../assets/ui/psd160/save-button.png'
import projectionScreenUrl from '../../../../assets/ui/psd160/projection-screen.png'
import textBoxUrl from '../../../../assets/ui/psd160/text-box.png'

export const PSD160_DESIGN_WIDTH = manifest.designSize.width
export const PSD160_DESIGN_HEIGHT = manifest.designSize.height

export const psd160Assets = {
  background: backgroundUrl,
  backgroundDecor: backgroundDecorUrl,
  foxButton: foxButtonUrl,
  whiteBearButton: whiteBearButtonUrl,
  brownBearButton: brownBearButtonUrl,
  book: bookUrl,
  canvasFrame: canvasFrameUrl,
  saveButton: saveButtonUrl,
  projectionScreen: projectionScreenUrl,
  textBox: textBoxUrl
} as const

export type FrameSlug = 'book' | 'canvas-frame' | 'projection-screen'

export type BoundsSlug = 'book-bounds' | 'canvas-bounds' | 'projection-screen-bounds'

export const frameAssetBySlug: Record<FrameSlug, string> = {
  book: psd160Assets.book,
  'canvas-frame': psd160Assets.canvasFrame,
  'projection-screen': psd160Assets.projectionScreen
}

/** PSD content-clip layer for each decorative frame (absolute artboard coordinates). */
export const frameBoundsBySlug: Record<FrameSlug, BoundsSlug> = {
  book: 'book-bounds',
  'canvas-frame': 'canvas-bounds',
  'projection-screen': 'projection-screen-bounds'
}

export const textBoxTokens = {
  border: '#d4a843',
  fill: '#f5ecd8',
  outline: '#5c4030'
} as const

type Bbox = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function bboxFor(slug: string): Bbox {
  const layer = manifest.layers.find((entry) => entry.slug === slug)
  if (!layer) throw new Error(`Missing PSD layer bbox for ${slug}`)
  return layer.bbox
}

/** PSD bbox → percentage placement on the 1920×1080 artboard (size unchanged). */
export function psdBoxStyle(slug: string): Record<string, string> {
  const box = bboxFor(slug)
  return {
    left: `${(box.left / PSD160_DESIGN_WIDTH) * 100}%`,
    top: `${(box.top / PSD160_DESIGN_HEIGHT) * 100}%`,
    width: `${(box.width / PSD160_DESIGN_WIDTH) * 100}%`,
    height: `${(box.height / PSD160_DESIGN_HEIGHT) * 100}%`
  }
}

/** Fixed-position chrome aligned to a bounds box (above shell decor, z-index 90). */
export function psdFixedChromeStyle(
  boundsSlug: BoundsSlug,
  options?: {
    offsetX?: string
    offsetY?: string
    anchor?: 'top' | 'center-left'
  }
): Record<string, string> {
  const box = bboxFor(boundsSlug)
  const base: Record<string, string> = {
    position: 'fixed',
    zIndex: '90',
    pointerEvents: 'auto'
  }

  if (options?.anchor === 'center-left') {
    return {
      ...base,
      left: `calc(${(box.left / PSD160_DESIGN_WIDTH) * 100}% + ${options.offsetX ?? '0px'})`,
      top: `calc(${(box.top / PSD160_DESIGN_HEIGHT) * 100}% + ${(box.height / PSD160_DESIGN_HEIGHT) * 50}% + ${options.offsetY ?? '0px'})`,
      transform: 'translateY(-50%)'
    }
  }

  return {
    ...base,
    left: `${(box.left / PSD160_DESIGN_WIDTH) * 100}%`,
    top: `calc(${(box.top / PSD160_DESIGN_HEIGHT) * 100}% + ${options?.offsetY ?? '0px'})`,
    width: `${(box.width / PSD160_DESIGN_WIDTH) * 100}%`
  }
}

/** Strip below content bounds but inside the decorative frame — for book pager controls. */
export function psdFooterStripStyle(frameSlug: FrameSlug): Record<string, string> {
  const frame = bboxFor(frameSlug)
  const bounds = bboxFor(frameBoundsBySlug[frameSlug])
  const top = bounds.bottom
  const height = Math.max(0, frame.bottom - bounds.bottom)
  return {
    left: `${(frame.left / PSD160_DESIGN_WIDTH) * 100}%`,
    top: `${(top / PSD160_DESIGN_HEIGHT) * 100}%`,
    width: `${(frame.width / PSD160_DESIGN_WIDTH) * 100}%`,
    height: `${(height / PSD160_DESIGN_HEIGHT) * 100}%`
  }
}

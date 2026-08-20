import overrides from '../../../../assets/ui/ui-layout-overrides.json'

type SizeOverride = { width?: number; height?: number }
type TextButtonOverride = { minHeight?: number; minWidth?: number }
type LibraryOverride = {
  bookPagerOffsetY?: number
  bookPageLeftOffsetX?: number
  bookPageLeftOffsetY?: number
  bookPageRightOffsetX?: number
  bookPageRightOffsetY?: number
  bookPageInsetPx?: number
  bookPageGapPx?: number
}
type EditorOverride = {
  topbarOffsetY?: number
  backgroundButtonOffsetX?: number
  backgroundButtonLeftPx?: number
  canvasAspectWidth?: number
  canvasAspectHeight?: number
  canvasFillScale?: number
}
type QaSheetOverride = {
  widthPx?: number
  topPx?: number
  rightPx?: number
  bottomPx?: number
  paddingPx?: number
  inputMinHeightPx?: number
  zIndex?: number
}

function setPx(name: string, value: number | undefined): void {
  if (value === undefined) return
  document.documentElement.style.setProperty(name, `${value}px`)
}

function setNum(name: string, value: number | undefined): void {
  if (value === undefined) return
  document.documentElement.style.setProperty(name, String(value))
}

function camelToKebab(value: string): string {
  return value.replace(/([A-Z])/g, '-$1').toLowerCase()
}

/** Apply user-editable layout overrides from assets/ui/ui-layout-overrides.json */
export function applyUiLayoutOverrides(): void {
  const root = document.documentElement
  const library = overrides.library as LibraryOverride
  const editor = overrides.editor as EditorOverride
  const icon = overrides.iconButtons as Record<string, SizeOverride>
  const textButtons = overrides.textButtons as Record<string, TextButtonOverride>
  const qa = overrides.qaSheet as QaSheetOverride

  setPx('--ui-library-pager-offset-y', library.bookPagerOffsetY)
  setPx('--ui-library-page-left-offset-x', library.bookPageLeftOffsetX)
  setPx('--ui-library-page-left-offset-y', library.bookPageLeftOffsetY)
  setPx('--ui-library-page-right-offset-x', library.bookPageRightOffsetX)
  setPx('--ui-library-page-right-offset-y', library.bookPageRightOffsetY)
  setPx('--ui-library-page-inset', library.bookPageInsetPx)
  setPx('--ui-library-page-gap', library.bookPageGapPx)

  setPx('--ui-editor-topbar-offset-y', editor.topbarOffsetY)
  setPx('--ui-editor-background-offset-x', editor.backgroundButtonOffsetX)
  setPx('--ui-editor-background-left', editor.backgroundButtonLeftPx)
  setNum('--ui-canvas-aspect-w', editor.canvasAspectWidth)
  setNum('--ui-canvas-aspect-h', editor.canvasAspectHeight)
  setNum('--ui-canvas-fill-scale', editor.canvasFillScale)

  for (const [key, size] of Object.entries(icon)) {
    const slug = camelToKebab(key)
    setPx(`--ui-icon-${slug}-width`, size.width)
    setPx(`--ui-icon-${slug}-height`, size.height)
  }

  for (const [key, button] of Object.entries(textButtons)) {
    const slug = camelToKebab(key)
    setPx(`--ui-btn-${slug}-height`, button.minHeight)
    setPx(`--ui-btn-${slug}-min-width`, button.minWidth)
  }

  setPx('--ui-qa-sheet-width', qa.widthPx)
  setPx('--ui-qa-sheet-top', qa.topPx)
  setPx('--ui-qa-sheet-right', qa.rightPx)
  setPx('--ui-qa-sheet-bottom', qa.bottomPx)
  setPx('--ui-qa-sheet-padding', qa.paddingPx)
  setPx('--ui-qa-input-min-height', qa.inputMinHeightPx)
  setNum('--ui-qa-sheet-z-index', qa.zIndex)

  root.dataset.uiOverrides = 'applied'
}

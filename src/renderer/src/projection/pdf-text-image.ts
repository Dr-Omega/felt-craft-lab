const PDF_FONT_FAMILY = '"ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif'

let fontReady: Promise<void> | undefined

/** Ensure the UI Chinese font is loaded before rasterizing PDF labels. */
export function ensurePdfTextFont(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  if (!fontReady) {
    fontReady = document.fonts
      .load(`12px ${PDF_FONT_FAMILY}`)
      .then(() => document.fonts.ready)
      .then(() => undefined)
  }
  return fontReady
}

export interface PdfTextRaster {
  dataUrl: string
  widthMm: number
  heightMm: number
}

/** Rasterize text with the app font so jsPDF can embed it without garbled CJK glyphs. */
export function rasterizePdfText(
  text: string,
  fontSizePt: number,
  color = '#594738',
  pixelRatio = 1
): PdfTextRaster {
  const fontSizePx = (fontSizePt * 96) / 72
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 PDF 文字画布')

  const font = `${fontSizePx}px ${PDF_FONT_FAMILY}`
  ctx.font = font
  const metrics = ctx.measureText(text)
  const widthPx = Math.ceil(metrics.width) + 4
  const heightPx = Math.ceil(fontSizePx * 1.35)
  canvas.width = Math.ceil(widthPx * pixelRatio)
  canvas.height = Math.ceil(heightPx * pixelRatio)

  ctx.scale(pixelRatio, pixelRatio)
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.fillText(text, 2, 1)

  const pxToMm = 25.4 / 96
  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthMm: widthPx * pxToMm,
    heightMm: heightPx * pxToMm
  }
}

import { cuttingLabel, type CuttingPage } from './cutting-layout'
import { CUT_STROKE_COLOR, CUT_STROKE_MM } from './print-settings'

/** Render the actual first print sheet, not an artwork collage or UI screenshot. */
export async function cuttingPageThumbnail(page: CuttingPage): Promise<string> {
  const width = page.landscape ? 297 : 210, height = page.landscape ? 210 : 297, density = 2.5
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * density); canvas.height = Math.ceil(height * density)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法生成图纸缩略图。')
  ctx.scale(density, density)
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height)
  for (const piece of page.pieces) {
    if (piece.imageUrl) {
      const image = new Image(); image.src = piece.imageUrl; await image.decode()
      ctx.drawImage(image, piece.x, piece.y, piece.width, piece.height)
      continue
    }
    ctx.beginPath()
    for (const ring of piece.rings) {
      ring.forEach(([x, y], index) => index ? ctx.lineTo(piece.x + x, piece.y + y) : ctx.moveTo(piece.x + x, piece.y + y))
      ctx.closePath()
    }
    ctx.fillStyle = piece.color; ctx.strokeStyle = CUT_STROKE_COLOR; ctx.lineWidth = CUT_STROKE_MM
    ctx.fill('evenodd'); ctx.stroke()
  }
  ctx.fillStyle = '#222222'; ctx.font = `${10 * 25.4 / 72}px Arial`; ctx.textBaseline = 'alphabetic'
  for (const label of page.labels) ctx.fillText(cuttingLabel(label), label.x, label.y)
  return canvas.toDataURL('image/png')
}

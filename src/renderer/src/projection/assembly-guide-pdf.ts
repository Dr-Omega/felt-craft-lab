import type { jsPDF } from 'jspdf'
import { guideBounds, type AssemblyGuide, type AssemblyGroup, type AssemblyStep, type GuideBounds } from './assembly-guide'
import type { CutPiece } from './cutting-layout'
import { ensurePdfTextFont, rasterizePdfText } from './pdf-text-image'

interface Box { x: number; y: number; width: number; height: number }
function fit(bounds: GuideBounds, box: Box) {
  const scale = Math.min(box.width / bounds.width, box.height / bounds.height)
  return { scale, x: box.x + (box.width - bounds.width * scale) / 2, y: box.y + (box.height - bounds.height * scale) / 2 }
}
function paintPieces(doc: jsPDF, pieces: CutPiece[], bounds: GuideBounds, box: Box) {
  const { scale, x, y } = fit(bounds, box)
  for (const piece of pieces) {
    if (piece.imageUrl) {
      const own = guideBounds([piece])
      doc.addImage(piece.imageUrl, 'PNG', x + (own.x - bounds.x) * scale, y + (own.y - bounds.y) * scale, own.width * scale, own.height * scale)
      continue
    }
    doc.setFillColor(piece.color); doc.setDrawColor('#555555'); doc.setLineWidth(0.12)
    for (const ring of piece.rings) {
      doc.lines(ring.slice(1).map((point, index) => [(point[0] - ring[index][0]) * scale, (point[1] - ring[index][1]) * scale]),
        x + (ring[0][0] - bounds.x) * scale, y + (ring[0][1] - bounds.y) * scale, [1, 1], null, true)
    }
    doc.fillStrokeEvenOdd()
  }
}
function paintStep(doc: jsPDF, group: AssemblyGroup, step: AssemblyStep, x: number, y: number, width: number) {
  doc.setFontSize(11); doc.setTextColor('#222222')
  doc.text(`+ ${step.label}`, x, y + 5)
  // Show exactly what to add, including disconnected islands in one making layer.
  paintPieces(doc, step.added, guideBounds(step.added), { x: x + width - 27, y, width: 19, height: 10 })
  doc.setDrawColor('#555555'); doc.setLineWidth(0.25)
  doc.line(x + width - 5, y + 3, x + width - 5, y + 8)
  doc.line(x + width - 7, y + 6, x + width - 5, y + 8)
  doc.line(x + width - 3, y + 6, x + width - 5, y + 8)
  const box = { x: x + 2, y: y + 13, width: width - 4, height: 43 }
  if (step.imageUrl) {
    const fitted = fit(group.bounds, box)
    doc.addImage(step.imageUrl, 'PNG', fitted.x, fitted.y, group.bounds.width * fitted.scale, group.bounds.height * fitted.scale)
  } else paintPieces(doc, step.pieces, group.bounds, box)
}

/** Append after the full-size templates. Independent compact scale, no UI preview. */
export async function appendAssemblyGuide(doc: jsPDF, guide: AssemblyGuide): Promise<void> {
  if (!guide.groups.length) return
  await ensurePdfTextFont()
  const margin = 12, gap = 8, rowHeight = 62
  let y = 297
  const page = () => { doc.addPage('a4', 'portrait'); y = margin }
  const heading = (text: string) => {
    const image = rasterizePdfText(text, 11, '#222222', 3)
    const shrink = Math.min(1, 186 / image.widthMm)
    doc.addImage(image.dataUrl, 'PNG', margin, y, image.widthMm * shrink, image.heightMm * shrink)
    y += 9
  }
  let previousKind: AssemblyGroup['kind'] | undefined
  for (const group of guide.groups) {
    const columns = group.kind === 'scene' ? 2 : 3
    const width = (210 - 2 * margin - gap * (columns - 1)) / columns
    // The final scene assembly starts on a clean page, after all element guides.
    if (group.kind !== previousKind || y + 9 + rowHeight > 285) page()
    heading(group.title)
    for (let index = 0; index < group.steps.length; index += columns) {
      if (y + rowHeight > 285) { page(); heading(group.title) }
      for (let column = 0; column < columns && index + column < group.steps.length; column++) {
        paintStep(doc, group, group.steps[index + column], margin + column * (width + gap), y, width)
      }
      y += rowHeight
    }
    y += 4; previousKind = group.kind
  }
}

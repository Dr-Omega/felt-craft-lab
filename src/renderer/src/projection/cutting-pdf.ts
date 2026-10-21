import { jsPDF } from 'jspdf'
import { cuttingLabel, type CuttingPlan } from './cutting-layout'
import type { AssemblyGuide } from './assembly-guide'
import { appendAssemblyGuide } from './assembly-guide-pdf'
import { CUT_STROKE_COLOR, CUT_STROKE_MM } from './print-settings'

export async function exportCuttingPdf(plan: CuttingPlan, _workName: string, guide?: AssemblyGuide): Promise<Blob> {
  if (!plan.pages.length) throw new Error('没有可导出的裁片。')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: plan.pages[0].landscape ? 'landscape' : 'portrait', compress: true, precision: 5, putOnlyUsedFonts: true })
  // Advisory only: public print sites may ignore viewer preferences.
  doc.viewerPreferences({ PrintScaling:'None', PickTrayByPDFSize:true })
  plan.pages.forEach((page, i) => {
    if (i) doc.addPage('a4', page.landscape ? 'landscape' : 'portrait')
    for (const piece of page.pieces) {
      if (piece.imageUrl) {
        doc.addImage(piece.imageUrl, 'PNG', piece.x, piece.y, piece.width, piece.height)
        continue
      }
      doc.setFillColor(piece.color); doc.setDrawColor(CUT_STROKE_COLOR); doc.setLineWidth(CUT_STROKE_MM)
      // One compound vector path per cut. Even-odd fill leaves real holes white,
      // independent of winding or a mirrored scene transform.
      for (const ring of piece.rings) {
        doc.lines(ring.slice(1).map((p, j) => [p[0] - ring[j][0], p[1] - ring[j][1]]),
          piece.x + ring[0][0], piece.y + ring[0][1], [1, 1], null, true)
      }
      doc.fillStrokeEvenOdd()
    }
    doc.setFontSize(10); doc.setTextColor('#222222')
    for (const label of page.labels) doc.text(cuttingLabel(label), label.x, label.y)
  })
  if (guide) await appendAssemblyGuide(doc, guide)
  return doc.output('blob')
}

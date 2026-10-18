import { jsPDF } from 'jspdf'
import { cuttingLabel, type CuttingPlan } from './cutting-layout'

export async function exportCuttingPdf(plan: CuttingPlan, _workName: string): Promise<Blob> {
  if (!plan.pages.length) throw new Error('没有可导出的裁片。')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, precision: 5, putOnlyUsedFonts: true })
  plan.pages.forEach((page, i) => {
    if (i) doc.addPage('a4', 'portrait')
    for (const piece of page.pieces) {
      doc.setFillColor(piece.color); doc.setDrawColor('#111111'); doc.setLineWidth(0.2)
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
  return doc.output('blob')
}

import { jsPDF } from 'jspdf'
import type { CuttingPlan } from './cutting-layout'
import { ensurePdfTextFont, rasterizePdfText } from './pdf-text-image'

export async function exportCuttingPdf(plan: CuttingPlan, workName: string): Promise<Blob> {
  if (!plan.pages.length) throw new Error('没有可导出的裁片。')
  await ensurePdfTextFont()
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, precision: 5 })
  const label = (text: string, x: number, y: number, fontSize = 10, maxWidth = 186) => {
    const raster = rasterizePdfText(text, fontSize, '#222222', 3)
    const ratio = Math.min(1, maxWidth / raster.widthMm)
    doc.addImage(raster.dataUrl, 'PNG', x, y, raster.widthMm * ratio, raster.heightMm * ratio)
  }
  plan.pages.forEach((page, i) => {
    if (i) doc.addPage('a4', 'portrait')
    label(`${workName.slice(0, 60)} · 同色裁片图纸`, 12, 8, 12)
    doc.setFillColor(page.color); doc.setDrawColor('#333333'); doc.setLineWidth(0.2); doc.rect(12, 18, 5, 5, 'FD')
    doc.setFontSize(9); doc.setTextColor('#222222')
    doc.text(`${page.color}   ${i + 1} / ${plan.pages.length}`, 20, 22)
    label(`成品 ${plan.widthMm.toFixed(1)} × ${plan.heightMm.toFixed(1)} mm · 编号 / 元素 / 拼贴步`, 65, 18, 9, 133)
    for (const piece of page.pieces) {
      doc.setDrawColor('#111111'); doc.setLineWidth(0.2)
      // Stroke every exterior and hole ring as vector paths. No rectangular thumbnail outlines.
      for (const ring of piece.rings) {
        doc.lines(ring.slice(1).map((p, j) => [p[0] - ring[j][0], p[1] - ring[j][1]]),
          piece.x + ring[0][0], piece.y + ring[0][1], [1, 1], 'S', true)
      }
      doc.setFontSize(8)
      doc.text(`${piece.number} / E${piece.element} / S${piece.step}`, piece.x, piece.y + piece.height + 4)
    }
    doc.setLineWidth(0.3); doc.line(12, 279, 62, 279); doc.line(12, 277, 12, 281); doc.line(62, 277, 62, 281)
    doc.setFontSize(8); doc.text('50 mm', 30, 276)
    label('A4 · 100% / 实际大小打印，关闭“适合页面”；先用尺核对 50 mm。', 68, 274, 9, 130)
    label('实线为裁剪线（含镂空）。按元素及拼贴步组装；先试剪，细小裁片需成人协助。', 12, 284, 8)
    label('依据拆分设计生成；未完成实物制作验证。画布底色与场景背景不作为裁片。', 12, 289, 8)
  })
  return doc.output('blob')
}

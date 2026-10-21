import { jsPDF } from 'jspdf'
import { CUT_STROKE_COLOR, CUT_STROKE_MM } from './print-settings'

/** Standalone test sheet, never appended to a work's cutting/assembly PDF. */
export function exportPrintCalibrationPdf(): Blob {
  const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape',precision:5,compress:true,putOnlyUsedFonts:true})
  doc.viewerPreferences({PrintScaling:'None',PickTrayByPDFSize:true})
  doc.setDrawColor(CUT_STROKE_COLOR);doc.setTextColor(CUT_STROKE_COLOR);doc.setLineWidth(CUT_STROKE_MM)
  doc.setFontSize(14);doc.text('100% / Actual size',30,25)
  doc.rect(30,45,100,100)
  doc.setFontSize(11);doc.text('100 mm',80,40,{align:'center'})
  doc.text('100 mm',25,95,{angle:90,align:'center'})
  doc.line(165,70,215,70);doc.line(165,67,165,73);doc.line(215,67,215,73)
  doc.text('50 mm',190,63,{align:'center'})
  doc.setFillColor(CUT_STROKE_COLOR);doc.rect(165,95,10,10,'F');doc.text('10 mm',180,102)
  return doc.output('blob')
}

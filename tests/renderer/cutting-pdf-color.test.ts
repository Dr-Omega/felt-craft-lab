import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportCuttingPdf } from '../../src/renderer/src/projection/cutting-pdf'
import { cuttingLabel, planCuttingPages, type CutPiece } from '../../src/renderer/src/projection/cutting-layout'
import { defaultSubjectSizeChoice } from '../../src/renderer/src/projection/subject-size'

const doc = vi.hoisted(() => ({
  addPage: vi.fn(), addImage: vi.fn(), setFillColor: vi.fn(), setDrawColor: vi.fn(), setLineWidth: vi.fn(), rect: vi.fn(),
  setFontSize: vi.fn(), setTextColor: vi.fn(), text: vi.fn(), lines: vi.fn(), fillStrokeEvenOdd: vi.fn(), line: vi.fn(),
  output: vi.fn(() => new Blob(['pdf'], { type: 'application/pdf' }))
}))
vi.mock('jspdf', () => ({ jsPDF: class { constructor() { return doc } } }))
vi.mock('../../src/renderer/src/projection/pdf-text-image', () => ({
  ensurePdfTextFont: async () => {}, rasterizePdfText: () => ({ dataUrl: 'mock', widthMm: 100, heightMm: 4 })
}))
beforeEach(() => vi.clearAllMocks())
describe('filled color cutting PDF', () => {
  it('prints one shared number for all disconnected cuts in the same making layer', async () => {
    const cuts: CutPiece[] = [0,20].map((x,i) => ({id:String(i),color:'#FF0000',element:3,step:2,
      rings:[[[x,0],[x+10,0],[x+10,10],[x,10]]] }))
    const plan=planCuttingPages(cuts,defaultSubjectSizeChoice())
    await exportCuttingPdf(plan,'分离裁片')
    expect(doc.fillStrokeEvenOdd).toHaveBeenCalledTimes(2)
    expect(doc.text).toHaveBeenCalledTimes(1)
    expect(doc.text.mock.calls[0][0]).toBe('3-2')
  })
  it('fills every cut in its actual color using one even-odd compound path, preserving holes regardless of winding', async () => {
    const cuts: CutPiece[] = [{ id: 'ring', color: '#3575CF', step: 1, element: 1,
      rings: [[[0,0],[100,0],[100,100],[0,100]], [[30,30],[70,30],[70,70],[30,70]]] }]
    const plan = planCuttingPages(cuts, defaultSubjectSizeChoice()), before = JSON.stringify(plan)
    await exportCuttingPdf(plan, '原色裁片')
    expect(doc.setFillColor).toHaveBeenLastCalledWith('#3575CF')
    expect(doc.lines).toHaveBeenCalledTimes(2)
    for (const call of doc.lines.mock.calls) {
      expect(call[4]).toBeNull() // accumulate both exterior and hole before filling
      expect(call[5]).toBe(true)
    }
    expect(doc.fillStrokeEvenOdd).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(plan)).toBe(before)
  })
  it('keeps opaque white material white, black material black, and labels below their shapes', async () => {
    const cuts: CutPiece[] = ['#FFFFFF','#000000'].map((color, i) => ({ id: String(i), color, step: i+1, element: 1,
      rings: [[[0,0],[50,0],[50,50],[0,50]]] }))
    const plan = planCuttingPages(cuts, defaultSubjectSizeChoice())
    await exportCuttingPdf(plan, '白黑裁片')
    expect(doc.setFillColor).toHaveBeenCalledWith('#FFFFFF')
    expect(doc.setFillColor).toHaveBeenCalledWith('#000000')
    expect(doc.fillStrokeEvenOdd).toHaveBeenCalledTimes(2)
    expect(doc.addPage).toHaveBeenCalledTimes(1)
    for (const page of plan.pages) for (const label of page.labels) {
      expect(doc.text).toHaveBeenCalledWith(cuttingLabel(label), label.x, label.y)
    }
    expect(doc.text).toHaveBeenCalledTimes(2)
    for (const call of doc.text.mock.calls) expect(call[0]).toMatch(/^\d+-\d+$/)
    expect(doc.addImage).not.toHaveBeenCalled(); expect(doc.rect).not.toHaveBeenCalled(); expect(doc.line).not.toHaveBeenCalled()
  })
})

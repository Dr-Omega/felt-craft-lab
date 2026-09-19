import { jsPDF } from 'jspdf'
import type { LoadedLayerImage } from './load-layer-image'
import { ensurePdfTextFont, rasterizePdfText } from './pdf-text-image'

export type PaperSize = 'a4' | 'a3'

export interface LayoutLayerInput {
  descriptor: ProjectionLayerDescriptor
  image: LoadedLayerImage
}

interface PlacedRect {
  x: number
  y: number
  width: number
  height: number
  layer: LayoutLayerInput
}

interface PageLayout {
  placed: PlacedRect[]
}

const PAGE_MM: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 }
}

const MARGIN_MM = 12
const GAP_MM = 6
const MAX_LAYER_WIDTH_MM = 72

/** Row-flow packing with per-layer aspect scaling (Q16-C). */
export function layoutLayersOnPages(layers: LayoutLayerInput[], paper: PaperSize): PageLayout[] {
  const pageSize = PAGE_MM[paper]
  const innerW = pageSize.width - MARGIN_MM * 2
  const innerH = pageSize.height - MARGIN_MM * 2
  const pages: PageLayout[] = []
  let queue = layers.slice()

  while (queue.length > 0) {
    const placed: PlacedRect[] = []
    let cursorX = MARGIN_MM
    let cursorY = MARGIN_MM
    let rowHeight = 0
    const remaining: LayoutLayerInput[] = []

    for (const layer of queue) {
      const size = fitLayerSize(layer, MAX_LAYER_WIDTH_MM)
      if (cursorX + size.width > MARGIN_MM + innerW && cursorX > MARGIN_MM) {
        cursorX = MARGIN_MM
        cursorY += rowHeight + GAP_MM
        rowHeight = 0
      }
      if (cursorY + size.height > MARGIN_MM + innerH) {
        remaining.push(layer)
        continue
      }
      placed.push({
        x: cursorX,
        y: cursorY,
        width: size.width,
        height: size.height,
        layer
      })
      cursorX += size.width + GAP_MM
      rowHeight = Math.max(rowHeight, size.height)
    }

    if (placed.length === 0 && remaining.length > 0) {
      const solo = remaining.shift()!
      const size = fitLayerSize(solo, Math.min(innerW, innerH))
      placed.push({
        x: MARGIN_MM + (innerW - size.width) / 2,
        y: MARGIN_MM + (innerH - size.height) / 2,
        width: size.width,
        height: size.height,
        layer: solo
      })
      pages.push({ placed })
      queue = remaining
      continue
    }

    pages.push({ placed })
    queue = remaining
  }

  return pages
}

function fitLayerSize(layer: LayoutLayerInput, maxWidthMm: number): { width: number; height: number } {
  const aspect = layer.image.width / Math.max(1, layer.image.height)
  const width = Math.min(maxWidthMm, maxWidthMm)
  const height = width / aspect
  return { width, height }
}

function drawPdfText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  fontSizePt: number,
  align: 'left' | 'right' = 'left'
): void {
  const raster = rasterizePdfText(text, fontSizePt)
  const drawX = align === 'right' ? x - raster.widthMm : x
  const drawY = y - raster.heightMm * 0.82
  doc.addImage(raster.dataUrl, 'PNG', drawX, drawY, raster.widthMm, raster.heightMm, undefined, 'FAST')
}

export async function exportLayoutPdf(options: {
  workName: string
  paper: PaperSize
  layers: LayoutLayerInput[]
}): Promise<Blob> {
  await ensurePdfTextFont()
  const pages = layoutLayersOnPages(options.layers, options.paper)
  const firstSize = PAGE_MM[options.paper]
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: options.paper === 'a3' ? 'a3' : 'a4'
  })

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (pageIndex > 0) {
      doc.addPage(options.paper === 'a3' ? 'a3' : 'a4', 'portrait')
    }
    const page = pages[pageIndex]!
    drawPdfText(doc, options.workName.trim() || '我的作品', MARGIN_MM, 8, 11)
    drawPdfText(
      doc,
      `第 ${pageIndex + 1} / ${pages.length} 页`,
      firstSize.width - MARGIN_MM,
      8,
      9,
      'right'
    )

    for (const item of page.placed) {
      const dataUrl = await layerToPngDataUrl(item.layer)
      doc.addImage(dataUrl, 'PNG', item.x, item.y, item.width, item.height, undefined, 'FAST')
      drawCutGuide(doc, item)
      drawPdfText(doc, String(item.layer.descriptor.layerNumber), item.x + 2, item.y + 5, 10)
      drawPdfText(doc, item.layer.descriptor.label, item.x + 2, item.y + item.height - 2, 8)
    }
  }

  return doc.output('blob')
}

function drawCutGuide(doc: jsPDF, item: PlacedRect): void {
  doc.setLineDashPattern([2, 2], 0)
  doc.setDrawColor(140, 110, 80)
  doc.rect(item.x, item.y, item.width, item.height)
  doc.setLineDashPattern([], 0)
}

async function layerToPngDataUrl(layer: LayoutLayerInput): Promise<string> {
  const image = await decodeImage(layer.image.objectUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建排版画布')
  ctx.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('排版图片解码失败'))
    image.src = src
  })
}

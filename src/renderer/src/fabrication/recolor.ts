import { validHex, rgbHex, type LayerColors } from '@shared/fabrication-colors'

export function tintPixels(source: Uint8ClampedArray, hex: string): Uint8ClampedArray {
  const rgb = validHex(hex).slice(1).match(/../g)!.map(v => parseInt(v, 16))
  const output = new Uint8ClampedArray(source)
  for (let i = 0; i < output.length; i += 4) {
    // Keep transparent pixels and the exact alpha; never use their hidden RGB.
    if (output[i + 3]) output.set(rgb, i)
  }
  return output
}
export function hsvHex(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  const rgb = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x]
  return rgbHex(rgb.map(n => Math.round((n + m) * 255)))
}
export async function recolorLayers(doc: LayerColors, masks: string[], width: number, height: number): Promise<{ layers: string[]; assemblies: string[]; composite: string }> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const composite = document.createElement('canvas'); composite.width = width; composite.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const paint = composite.getContext('2d')!
  const layers: string[] = [], assemblies: string[] = []
  for (const layer of doc.layers) {
    const image = new Image(); image.src = masks[layer.layerIndex]; await image.decode()
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('图层坐标尺寸不一致。')
    ctx.clearRect(0, 0, width, height); ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, width, height)
    pixels.data.set(tintPixels(pixels.data, layer.hex)); ctx.putImageData(pixels, 0, 0)
    layers.push(canvas.toDataURL('image/png'))
    paint.drawImage(canvas, 0, 0)
    assemblies.push(composite.toDataURL('image/png'))
  }
  return { layers, assemblies, composite: assemblies.at(-1) || '' }
}

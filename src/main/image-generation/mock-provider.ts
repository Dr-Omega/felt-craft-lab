import type { GenerationSpec } from '@shared/contracts/generation-spec'
import type { ProviderPromptPayload } from '@shared/contracts/generation-candidate'
import { encodeRgbaPng } from './encode-png'

const PAPER: [number, number, number] = [232, 240, 238]
const FELT: Record<string, [number, number, number]> = {
  白色: [244, 244, 240],
  金色: [212, 176, 80],
  红色: [196, 92, 74],
  粉色: [224, 164, 168],
  绿色: [110, 148, 108],
  蓝色: [96, 140, 168],
  黄色: [220, 188, 84],
  橙色: [212, 132, 72],
  紫色: [148, 124, 168],
  黑色: [56, 64, 62]
}
const FALLBACK: Array<[number, number, number]> = [
  [31, 111, 99],
  [212, 176, 80],
  [196, 92, 74]
]

function colorAt(names: string[], index: number): [number, number, number] {
  const named = names[index]
  if (named && FELT[named]) return FELT[named]
  return FALLBACK[index % FALLBACK.length]
}

function fill(pixels: Uint8Array, rgb: [number, number, number]): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgb[0]
    pixels[i + 1] = rgb[1]
    pixels[i + 2] = rgb[2]
    pixels[i + 3] = 255
  }
}

function fillCircle(
  pixels: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number]
): void {
  const r2 = radius * radius
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > r2) continue
      const i = (y * width + x) * 4
      pixels[i] = rgb[0]
      pixels[i + 1] = rgb[1]
      pixels[i + 2] = rgb[2]
      pixels[i + 3] = 255
    }
  }
}

/**
 * Local stand-in for cloud T2I. Emits a felt-like flat color-block PNG so the
 * candidate pipeline can run before a Provider is chosen.
 */
export function renderMockFeltPng(payload: ProviderPromptPayload, spec: GenerationSpec): Buffer {
  const width = payload.width
  const height = payload.height
  const pixels = new Uint8Array(width * height * 4)
  fill(pixels, PAPER)
  const colors = spec.content.preferredColors ?? []
  const count = Math.max(1, Math.min(3, spec.content.primarySubjects.length || 1))
  const radius = Math.floor(Math.min(width, height) / (count === 1 ? 3.2 : 4.2))
  for (let index = 0; index < count; index += 1) {
    const cx = Math.floor(width * (0.32 + index * 0.22))
    const cy = Math.floor(height * (0.48 + (index % 2 === 0 ? -0.04 : 0.06)))
    fillCircle(pixels, width, height, cx, cy, radius, colorAt(colors, index))
  }
  return encodeRgbaPng(width, height, pixels)
}

export type SubjectSizeMode = 'specific' | 'metaphor'

export interface SubjectSizeChoice {
  mode: SubjectSizeMode
  /** Longer edge target in millimeters on paper. */
  targetLongEdgeMm: number
  label: string
}

export interface SizeMetaphorOption {
  id: string
  label: string
  description: string
  longEdgeCm: number
}

export const SIZE_METAPHOR_OPTIONS: SizeMetaphorOption[] = [
  { id: 'grape', label: '一颗葡萄', description: '小巧细节，约 3cm', longEdgeCm: 3 },
  { id: 'coin', label: '一枚硬币', description: '掌心小物，约 5cm', longEdgeCm: 5 },
  { id: 'apple', label: '一个苹果', description: '常见水果，约 8cm', longEdgeCm: 8 },
  { id: 'orange', label: '一个橙子', description: '稍大一些，约 10cm', longEdgeCm: 10 },
  { id: 'palm', label: '小朋友手掌', description: '手作练习，约 14cm', longEdgeCm: 14 },
  { id: 'picture-book', label: '绘本一页', description: '故事插图，约 20cm', longEdgeCm: 20 },
  { id: 'a4-sheet', label: 'A4 纸短边', description: '接近整页，约 21cm', longEdgeCm: 21 },
  { id: 'cushion', label: '小坐垫', description: '布偶主体，约 28cm', longEdgeCm: 28 },
  { id: 'backpack', label: '小书包正面', description: '大型主体，约 35cm', longEdgeCm: 35 },
  { id: 'desk-mat', label: '课桌面垫', description: '展示级，约 45cm', longEdgeCm: 45 }
]

const CM_TO_MM = 10

export function parseSpecificSizeCm(text: string): { widthCm: number; heightCm: number } | undefined {
  const normalized = text.replace(/×/g, 'x').replace(/\s/g, '').replace(/cm/gi, '')
  const match = normalized.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/)
  if (!match) return undefined
  const widthCm = Number(match[1])
  const heightCm = Number(match[2])
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm) || widthCm <= 0 || heightCm <= 0) {
    return undefined
  }
  return { widthCm, heightCm }
}

export function choiceFromSpecificInput(text: string): SubjectSizeChoice | undefined {
  const parsed = parseSpecificSizeCm(text)
  if (!parsed) return undefined
  const longEdgeCm = Math.max(parsed.widthCm, parsed.heightCm)
  return {
    mode: 'specific',
    targetLongEdgeMm: longEdgeCm * CM_TO_MM,
    label: `${parsed.widthCm}×${parsed.heightCm} cm`
  }
}

export function choiceFromMetaphor(optionId: string): SubjectSizeChoice | undefined {
  const option = SIZE_METAPHOR_OPTIONS.find((item) => item.id === optionId)
  if (!option) return undefined
  return {
    mode: 'metaphor',
    targetLongEdgeMm: option.longEdgeCm * CM_TO_MM,
    label: option.label
  }
}

/** Map desired long edge to layout cell width (clamped for A4 packing). */
export function maxLayerWidthMmForSubject(choice: SubjectSizeChoice): number {
  const innerW = 210 - 24
  const raw = choice.targetLongEdgeMm
  return Math.max(24, Math.min(innerW, raw))
}

export const DEFAULT_METAPHOR_ID = 'apple'

export function defaultSubjectSizeChoice(): SubjectSizeChoice {
  return choiceFromMetaphor(DEFAULT_METAPHOR_ID)!
}

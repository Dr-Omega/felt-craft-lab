export type SubjectSizeMode = 'specific' | 'metaphor'

export interface SubjectSizeChoice {
  mode: SubjectSizeMode
  /** Longer edge target in millimeters on paper. */
  targetLongEdgeMm: number
  /** Specific dimensions are a bounding box; the image is never stretched. */
  boundsMm?: { width: number; height: number }
  label: string
}

export interface SizeMetaphorOption {
  id: string
  label: string
  longEdgeCm: number
}

/** 可选比喻：仅三项，对应主体较长边约多少厘米。 */
export const SIZE_METAPHOR_OPTIONS: SizeMetaphorOption[] = [
  { id: 'egg', label: '一个鸡蛋', longEdgeCm: 6 },
  { id: 'apple', label: '一个苹果', longEdgeCm: 8 },
  { id: 'book', label: '一本书', longEdgeCm: 29.7 }
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

export function choiceFromSpecificCm(widthCm: number, heightCm: number): SubjectSizeChoice | undefined {
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm) || widthCm <= 0 || heightCm <= 0) {
    return undefined
  }
  const longEdgeCm = Math.max(widthCm, heightCm)
  return {
    mode: 'specific',
    targetLongEdgeMm: longEdgeCm * CM_TO_MM,
    boundsMm: { width: widthCm * CM_TO_MM, height: heightCm * CM_TO_MM },
    label: `${widthCm}×${heightCm} cm`
  }
}

export function choiceFromSpecificInput(text: string): SubjectSizeChoice | undefined {
  const parsed = parseSpecificSizeCm(text)
  if (!parsed) return undefined
  return choiceFromSpecificCm(parsed.widthCm, parsed.heightCm)
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

/** Both preview and PDF use the same physical size, independent of orientation. */
export function layoutOptionsForSubject(choice: SubjectSizeChoice) {
  return { maxLayerLongEdgeMm: choice.targetLongEdgeMm, boundsMm: choice.boundsMm }
}

/** Large enough to read and cut, while fitting A4 printable width in either orientation. */
export const DEFAULT_SUBJECT_LONG_EDGE_MM = 180

export function defaultSubjectSizeChoice(): SubjectSizeChoice {
  return choiceFromSpecificCm(DEFAULT_SUBJECT_LONG_EDGE_MM / CM_TO_MM, DEFAULT_SUBJECT_LONG_EDGE_MM / CM_TO_MM)!
}

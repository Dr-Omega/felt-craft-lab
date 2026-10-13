import type { GenerationSpec } from '../contracts/generation-spec'
import { colorAttributes } from './color-attributes'

/** Fixed plan columns shown on the creation page, regardless of how much was said. */
export const PLAN_FIELD_KEYS = [
  'content.primarySubjects',
  'content.actionOrRelationship',
  'content.preferredColors',
  'content.requiredElements',
  'content.forbiddenElements',
  'content.environmentDescription'
] as const

export type PlanFieldKey = (typeof PLAN_FIELD_KEYS)[number]

export type PlanFieldStatus = 'filled' | 'empty' | 'pending'

export interface CreationPlanField {
  key: PlanFieldKey
  label: string
  value: string
  status: PlanFieldStatus
  optional: boolean
}

export const PLAN_FIELD_LABELS: Record<PlanFieldKey, string> = {
  'content.primarySubjects': '画谁',
  'content.actionOrRelationship': '在做什么',
  'content.preferredColors': '颜色',
  'content.requiredElements': '必须有',
  'content.forbiddenElements': '不要',
  'content.environmentDescription': '场景'
}

export const EMPTY_PLAN_HINT = '还没说'

function formatSubjectLine(name: string, attributes?: string[]): string {
  const attrs = (attributes ?? []).map((item) => item.trim()).filter(Boolean)
  if (!attrs.length) return name
  return `${attrs.join('、')}${name}`
}

export function subjectLinesFromSpec(spec: GenerationSpec): string[] {
  return spec.content.primarySubjects
    .map((subject) => formatSubjectLine(subject.name.trim(), subject.attributes))
    .filter(Boolean)
}

export function colorLinesFromSpec(spec: GenerationSpec): string[] {
  const lines: string[] = []
  for (const subject of spec.content.primarySubjects) {
    const name = subject.name.trim()
    if (!name) continue
    const attrs = colorAttributes(subject.attributes)
    if (attrs.length) lines.push(`${attrs.join('、')}${name}`)
  }
  const bound = new Set(
    spec.content.primarySubjects.flatMap((subject) => subject.attributes ?? []).map((item) => item.trim())
  )
  for (const color of spec.content.preferredColors ?? []) {
    const trimmed = color.trim()
    if (trimmed && !bound.has(trimmed)) lines.push(trimmed)
  }
  return lines
}

function fieldValue(spec: GenerationSpec, key: PlanFieldKey): string {
  switch (key) {
    case 'content.primarySubjects':
      return subjectLinesFromSpec(spec).join('；')
    case 'content.actionOrRelationship':
      return spec.content.actionOrRelationship?.trim() ?? ''
    case 'content.preferredColors':
      return colorLinesFromSpec(spec).join('；')
    case 'content.requiredElements':
      return (spec.content.requiredElements ?? []).map((item) => item.trim()).filter(Boolean).join('、')
    case 'content.forbiddenElements':
      return (spec.content.forbiddenElements ?? []).map((item) => item.trim()).filter(Boolean).join('、')
    case 'content.environmentDescription':
      return spec.content.environmentDescription?.trim() ?? ''
  }
}

export function buildCreationPlanFields(
  spec: GenerationSpec,
  pendingField: string | null = null
): CreationPlanField[] {
  return PLAN_FIELD_KEYS.map((key) => {
    const value = fieldValue(spec, key)
    let status: PlanFieldStatus = value ? 'filled' : 'empty'
    if (pendingField === key) status = 'pending'
    return {
      key,
      label: PLAN_FIELD_LABELS[key],
      value,
      status,
      optional: key !== 'content.primarySubjects' && key !== pendingField
    }
  })
}

export function planHasAnyContent(fields: CreationPlanField[]): boolean {
  return fields.some((field) => field.value.length > 0)
}

import type { GenerationSpec } from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'

/** Virtual path: at least one subject still lacks a color attribute. */
export const SUBJECT_COLORS_FIELD = 'content.subjectColors' as const

export const PLAN_FIELD_PATHS = {
  subjects: 'content.primarySubjects',
  action: 'content.actionOrRelationship',
  colors: SUBJECT_COLORS_FIELD,
  required: 'content.requiredElements',
  forbidden: 'content.forbiddenElements',
  environment: 'content.environmentDescription'
} as const

export type PlanFieldPath = (typeof PLAN_FIELD_PATHS)[keyof typeof PLAN_FIELD_PATHS]

export interface PlanFieldSlot {
  id: keyof typeof PLAN_FIELD_PATHS
  path: PlanFieldPath
  label: string
  display: string
  status: 'filled' | 'empty' | 'pending'
  optional: boolean
}

export interface CreationPlanView {
  fields: PlanFieldSlot[]
}

const EMPTY_OPTIONAL = '（还没说，可跳过）'
const EMPTY_REQUIRED = '（还没说）'

function formatSubjectLine(name: string, attributes?: string[]): string {
  const attrs = (attributes ?? []).map((item) => item.trim()).filter(Boolean)
  if (!attrs.length) return name
  return `${attrs.join('、')}${name}`
}

function subjectsDisplay(spec: GenerationSpec): string {
  const lines = spec.content.primarySubjects
    .map((subject) => formatSubjectLine(subject.name.trim(), subject.attributes))
    .filter(Boolean)
  return lines.join('；')
}

function colorsDisplay(spec: GenerationSpec): string {
  const bound = spec.content.primarySubjects
    .map((subject) => {
      const attrs = (subject.attributes ?? []).map((item) => item.trim()).filter(Boolean)
      if (!attrs.length) return ''
      return `${attrs.join('、')}→${subject.name.trim()}`
    })
    .filter(Boolean)
  const extra = (spec.content.preferredColors ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
  return [...bound, ...extra.length ? [`其他：${extra.join('、')}`] : []].join('；')
}

function listDisplay(values: string[] | undefined): string {
  const items = (values ?? []).map((item) => item.trim()).filter(Boolean)
  return items.join('、')
}

export function subjectsNeedColors(spec: GenerationSpec): boolean {
  const subjects = spec.content.primarySubjects.filter((subject) => subject.name.trim().length > 0)
  if (!subjects.length) return false
  if ((spec.content.preferredColors ?? []).some((item) => item.trim())) return false
  return subjects.some((subject) => !(subject.attributes ?? []).some((item) => item.trim()))
}

function fieldSlotsForRole(role: PersonalAssetRole): Array<{
  id: PlanFieldSlot['id']
  path: PlanFieldPath
  label: string
  optional: boolean
}> {
  if (role === 'background') {
    return [
      { id: 'environment', path: PLAN_FIELD_PATHS.environment, label: '什么地方', optional: false },
      { id: 'subjects', path: PLAN_FIELD_PATHS.subjects, label: '画什么', optional: true },
      { id: 'colors', path: PLAN_FIELD_PATHS.colors, label: '颜色', optional: true },
      { id: 'required', path: PLAN_FIELD_PATHS.required, label: '必须有', optional: true },
      { id: 'forbidden', path: PLAN_FIELD_PATHS.forbidden, label: '不要', optional: true }
    ]
  }
  if (role === 'element') {
    return [
      { id: 'subjects', path: PLAN_FIELD_PATHS.subjects, label: '画谁', optional: false },
      { id: 'action', path: PLAN_FIELD_PATHS.action, label: '在做什么', optional: true },
      { id: 'colors', path: PLAN_FIELD_PATHS.colors, label: '颜色', optional: true },
      { id: 'required', path: PLAN_FIELD_PATHS.required, label: '必须有', optional: true },
      { id: 'forbidden', path: PLAN_FIELD_PATHS.forbidden, label: '不要', optional: true }
    ]
  }
  return [
    { id: 'subjects', path: PLAN_FIELD_PATHS.subjects, label: '画谁', optional: false },
    { id: 'action', path: PLAN_FIELD_PATHS.action, label: '在做什么', optional: false },
    { id: 'colors', path: PLAN_FIELD_PATHS.colors, label: '颜色', optional: false },
    { id: 'required', path: PLAN_FIELD_PATHS.required, label: '必须有', optional: true },
    { id: 'forbidden', path: PLAN_FIELD_PATHS.forbidden, label: '不要', optional: true },
    { id: 'environment', path: PLAN_FIELD_PATHS.environment, label: '场景', optional: true }
  ]
}

function displayForField(spec: GenerationSpec, id: PlanFieldSlot['id']): string {
  switch (id) {
    case 'subjects':
      return subjectsDisplay(spec)
    case 'action':
      return spec.content.actionOrRelationship?.trim() ?? ''
    case 'colors':
      return colorsDisplay(spec)
    case 'required':
      return listDisplay(spec.content.requiredElements)
    case 'forbidden':
      return listDisplay(spec.content.forbiddenElements)
    case 'environment':
      return spec.content.environmentDescription?.trim() ?? ''
    default:
      return ''
  }
}

function isFieldFilled(spec: GenerationSpec, id: PlanFieldSlot['id']): boolean {
  switch (id) {
    case 'subjects':
      return spec.content.primarySubjects.some((subject) => subject.name.trim().length > 0)
    case 'action':
      return Boolean(spec.content.actionOrRelationship?.trim())
    case 'colors':
      return !subjectsNeedColors(spec)
    case 'required':
      return Boolean((spec.content.requiredElements ?? []).some((item) => item.trim()))
    case 'forbidden':
      return Boolean((spec.content.forbiddenElements ?? []).some((item) => item.trim()))
    case 'environment':
      return Boolean(spec.content.environmentDescription?.trim())
    default:
      return false
  }
}

export function buildPlanView(spec: GenerationSpec, pendingField: string | null = null): CreationPlanView {
  const fields = fieldSlotsForRole(spec.assetRole).map((slot) => {
    const filled = isFieldFilled(spec, slot.id)
    const display = filled
      ? displayForField(spec, slot.id)
      : slot.optional
        ? EMPTY_OPTIONAL
        : EMPTY_REQUIRED
    return {
      ...slot,
      display,
      status:
        pendingField === slot.path ? ('pending' as const) : filled ? ('filled' as const) : ('empty' as const)
    }
  })
  return { fields }
}

export function hasPlanContent(spec: GenerationSpec): boolean {
  return buildPlanView(spec).fields.some((field) => field.status === 'filled')
}

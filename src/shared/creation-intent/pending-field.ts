import type { GenerationSpecPatch, GenerationSubject } from '../contracts/generation-spec'
import type { GenerationSpec } from '../contracts/generation-spec'
import { PLAN_FIELD_PATHS, SUBJECT_COLORS_FIELD, subjectsNeedColors } from './plan-fields'

const COLOR_WORDS = [
  '黑白',
  '白色',
  '金色',
  '红色',
  '粉色',
  '绿色',
  '蓝色',
  '黄色',
  '橙色',
  '紫色',
  '黑色',
  '灰色',
  '棕色'
] as const

const MAX_NAME = 16
const MAX_ACTION = 40

function trimText(text: string, max: number): string {
  return text.trim().slice(0, max)
}

function extractColors(text: string): string[] {
  const found = COLOR_WORDS.filter((word) => text.includes(word))
  return [...new Set(found)]
}

function attachColorsToSubjects(
  subjects: GenerationSubject[],
  colors: string[]
): GenerationSubject[] {
  if (!colors.length) return subjects
  let colorIndex = 0
  return subjects.map((subject) => {
    const attrs = subject.attributes ?? []
    if (attrs.some((item) => item.trim())) return subject
    const next = colors[colorIndex] ?? colors[colors.length - 1]
    colorIndex += 1
    return { ...subject, attributes: [...attrs, next] }
  })
}

/**
 * When the session is waiting on a specific plan slot, make sure the user's
 * answer lands on that field even if the parser returns an empty patch.
 */
export function enrichPatchForPendingField(
  pendingField: string | null,
  text: string,
  patch: GenerationSpecPatch,
  spec: GenerationSpec
): GenerationSpecPatch {
  if (!pendingField) return patch
  const trimmed = text.trim()
  if (!trimmed) return patch

  const content = { ...(patch.content ?? {}) }

  switch (pendingField) {
    case PLAN_FIELD_PATHS.subjects:
      if (!(content.primarySubjects?.length ?? spec.content.primarySubjects.length)) {
        content.primarySubjects = [{ name: trimText(trimmed, MAX_NAME) }]
      }
      break
    case PLAN_FIELD_PATHS.action:
      content.actionOrRelationship = trimText(trimmed, MAX_ACTION)
      break
    case SUBJECT_COLORS_FIELD: {
      const colors = extractColors(trimmed)
      const base = spec.content.primarySubjects.length
        ? spec.content.primarySubjects
        : (content.primarySubjects ?? [])
      if (base.length && colors.length) {
        content.primarySubjects = attachColorsToSubjects(base, colors)
      } else if (colors.length) {
        content.preferredColors = colors
      } else {
        content.preferredColors = [trimText(trimmed, MAX_NAME)]
      }
      break
    }
    case PLAN_FIELD_PATHS.required:
      content.requiredElements = [trimText(trimmed, MAX_NAME)]
      break
    case PLAN_FIELD_PATHS.forbidden:
      content.forbiddenElements = [trimText(trimmed, MAX_NAME)]
      break
    case PLAN_FIELD_PATHS.environment:
      content.environmentDescription = trimText(trimmed, MAX_ACTION)
      break
    default:
      break
  }

  if (!Object.keys(content).length) return patch
  return { ...patch, content: { ...patch.content, ...content } }
}

export function pendingFieldSatisfied(spec: GenerationSpec, pendingField: string | null): boolean {
  if (!pendingField) return true
  if (pendingField === SUBJECT_COLORS_FIELD) return !subjectsNeedColors(spec)
  if (pendingField === PLAN_FIELD_PATHS.subjects) {
    return spec.content.primarySubjects.some((subject) => subject.name.trim().length > 0)
  }
  if (pendingField === PLAN_FIELD_PATHS.action) {
    return Boolean(spec.content.actionOrRelationship?.trim())
  }
  if (pendingField === PLAN_FIELD_PATHS.required) {
    return Boolean((spec.content.requiredElements ?? []).some((item) => item.trim()))
  }
  if (pendingField === PLAN_FIELD_PATHS.forbidden) {
    return Boolean((spec.content.forbiddenElements ?? []).some((item) => item.trim()))
  }
  if (pendingField === PLAN_FIELD_PATHS.environment) {
    return Boolean(spec.content.environmentDescription?.trim())
  }
  return true
}

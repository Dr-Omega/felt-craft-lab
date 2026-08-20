import type { GenerationSpecPatch, GenerationSubject } from '../contracts/generation-spec'
import type { GenerationSpec } from '../contracts/generation-spec'
import { isSkipClarificationAnswer } from './clarification'

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
  return [...new Set(COLOR_WORDS.filter((word) => text.includes(word)))]
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
 * answer lands on that field even if the parser returns a thin patch.
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
  if (isSkipClarificationAnswer(trimmed)) return patch

  const content = { ...(patch.content ?? {}) }

  switch (pendingField) {
    case 'content.primarySubjects':
      if (!(content.primarySubjects?.length ?? spec.content.primarySubjects.length)) {
        content.primarySubjects = [{ name: trimText(trimmed, MAX_NAME) }]
      }
      break
    case 'content.actionOrRelationship':
      if (!content.actionOrRelationship?.trim()) {
        content.actionOrRelationship = trimText(trimmed, MAX_ACTION)
      }
      break
    case 'content.preferredColors':
    case 'content.subjectColors': {
      const colors = extractColors(trimmed)
      if (!colors.length) {
        // Posture/supplement while colors are pending — let action merge, don't pollute colors.
        break
      }
      const base = spec.content.primarySubjects.length
        ? spec.content.primarySubjects
        : (content.primarySubjects ?? [])
      if (base.length) {
        content.primarySubjects = attachColorsToSubjects(base, colors)
      } else {
        content.preferredColors = colors
      }
      break
    }
    case 'content.requiredElements':
      if (!content.requiredElements?.length) {
        content.requiredElements = [trimText(trimmed, MAX_NAME)]
      }
      break
    case 'content.forbiddenElements':
      if (!content.forbiddenElements?.length) {
        content.forbiddenElements = [trimText(trimmed, MAX_NAME)]
      }
      break
    case 'content.environmentDescription':
      if (!content.environmentDescription?.trim()) {
        content.environmentDescription = trimText(trimmed, MAX_ACTION)
      }
      break
    default:
      break
  }

  if (!Object.keys(content).length) return patch
  return { ...patch, content: { ...patch.content, ...content } }
}

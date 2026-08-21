import type {
  GenerationContentSpec,
  GenerationSpec,
  GenerationSubject
} from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'
import { validateGenerationSpec } from '../contracts/validation'
import { evaluateGenerationSpecCompleteness } from '../creation-intent/completeness'
import { BASE_NEGATIVE_PHRASES, rolePhraseList, stylePhraseList } from './phrases'

export const CANONICAL_PROMPT_SCHEMA_VERSION = 1 as const
export type CanonicalPromptSchemaVersion = typeof CANONICAL_PROMPT_SCHEMA_VERSION

export interface CanonicalPromptSections {
  subject: string
  action?: string
  environment?: string
  colors?: string
  required?: string
  style: string
  role: string
}

/**
 * Provider-neutral prompt package. Adapters (P0-03) may rewrite wording;
 * they must not invent new style rules outside these sections.
 */
export interface CanonicalPrompt {
  schemaVersion: CanonicalPromptSchemaVersion
  assetRole: PersonalAssetRole
  sections: CanonicalPromptSections
  positiveText: string
  negativeText: string
}

export type CompileCanonicalPromptFailureReason =
  | 'NOT_CONFIRMED'
  | 'INVALID_SPEC'
  | 'INCOMPLETE'

export type CompileCanonicalPromptResult =
  | { ok: true; value: CanonicalPrompt }
  | { ok: false; reason: CompileCanonicalPromptFailureReason }

function joinPhrases(parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join('，')
}

function formatSubject(subject: GenerationSubject): string {
  const attrs = subject.attributes?.filter((item) => item.trim().length > 0) ?? []
  const count = subject.count && subject.count > 1 ? `${subject.count}个` : ''
  const attrText = attrs.length ? attrs.join('') : ''
  return `${count}${attrText}${subject.name.trim()}`
}

function subjectSection(content: GenerationContentSpec): string {
  return content.primarySubjects
    .filter((subject) => subject.name.trim().length > 0)
    .map(formatSubject)
    .join('和')
}

function contentSections(content: GenerationContentSpec): Pick<
  CanonicalPromptSections,
  'subject' | 'action' | 'environment' | 'colors' | 'required'
> {
  const sections: Pick<
    CanonicalPromptSections,
    'subject' | 'action' | 'environment' | 'colors' | 'required'
  > = {
    subject: subjectSection(content)
  }
  if (content.actionOrRelationship?.trim()) {
    sections.action = content.actionOrRelationship.trim()
  }
  if (content.environmentDescription?.trim()) {
    sections.environment = content.environmentDescription.trim()
  }
  const unboundColors = unboundPreferredColors(content)
  if (unboundColors.length) {
    const subjectsHaveOwnColors = content.primarySubjects.some(
      (subject) => (subject.attributes?.filter((item) => item.trim().length > 0).length ?? 0) > 0
    )
    sections.colors = subjectsHaveOwnColors
      ? `另外颜色偏${unboundColors.join('、')}`
      : `颜色偏${unboundColors.join('、')}`
  }
  if (content.requiredElements?.length) {
    sections.required = `需要有${content.requiredElements.join('、')}`
  }
  return sections
}

/** Global preferredColors that are not already listed on any subject attributes. */
function unboundPreferredColors(content: GenerationContentSpec): string[] {
  const bound = new Set(
    content.primarySubjects
      .flatMap((subject) => subject.attributes ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
  )
  const seen = new Set<string>()
  const unbound: string[] = []
  for (const color of content.preferredColors ?? []) {
    const trimmed = color.trim()
    if (!trimmed || bound.has(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    unbound.push(trimmed)
  }
  return unbound
}

function negativeText(content: GenerationContentSpec): string {
  const forbidden = content.forbiddenElements?.map((item) => item.trim()).filter(Boolean) ?? []
  return [...forbidden, ...BASE_NEGATIVE_PHRASES].filter(
    (item, index, all) => item.length > 0 && all.indexOf(item) === index
  ).join('，')
}

/**
 * Deterministic compile. No LLM. Spec must already be user-confirmed.
 */
export function compileCanonicalPrompt(spec: GenerationSpec): CompileCanonicalPromptResult {
  const validated = validateGenerationSpec(spec)
  if (!validated.ok) return { ok: false, reason: 'INVALID_SPEC' }
  if (spec.confirmation.status !== 'confirmed') {
    return { ok: false, reason: 'NOT_CONFIRMED' }
  }

  const completeness = evaluateGenerationSpecCompleteness(spec)
  if (completeness.criticalFields.length > 0) {
    return { ok: false, reason: 'INCOMPLETE' }
  }

  const content = contentSections(spec.content)
  const style = stylePhraseList(spec.styleConstraints).join('，')
  const role = rolePhraseList(spec.assetRole, spec.roleConstraints).join('，')
  const sections: CanonicalPromptSections = {
    ...content,
    style,
    role
  }

  return {
    ok: true,
    value: {
      schemaVersion: CANONICAL_PROMPT_SCHEMA_VERSION,
      assetRole: spec.assetRole,
      sections,
      positiveText: joinPhrases([
        sections.subject,
        sections.action,
        sections.environment,
        sections.colors,
        sections.required,
        sections.style,
        sections.role
      ]),
      negativeText: negativeText(spec.content)
    }
  }
}

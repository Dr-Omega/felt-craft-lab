import {
  GENERATION_SPEC_POLLUTION_KEYS,
  type GenerationSpecPatch,
  type GenerationSubject
} from '../contracts/generation-spec'
import { PERSONAL_ASSET_ROLES, type PersonalAssetRole } from '../contracts/personal-asset'
import { mergeActionOrRelationship } from './patch'

const MAX_NAME_CHARS = 16
const MAX_ACTION_CHARS = 40
const MAX_COLOR_CHARS = 12
const MAX_ENV_CHARS = 80
const MAX_LIST_ITEMS = 8
const MAX_ATTRIBUTES = 4

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

function cleanStringList(value: unknown, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  const items = value
    .map((item) => cleanText(item, maxChars))
    .filter(Boolean)
  return [...new Set(items)].slice(0, MAX_LIST_ITEMS)
}

function cleanSubjects(value: unknown): GenerationSubject[] {
  if (!Array.isArray(value)) return []
  const subjects: GenerationSubject[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = asRecord(item)
    const name = cleanText(record?.name ?? item, MAX_NAME_CHARS)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const attributes = cleanStringList(record?.attributes, MAX_COLOR_CHARS).slice(0, MAX_ATTRIBUTES)
    subjects.push(attributes.length ? { name, attributes } : { name })
    if (subjects.length >= MAX_LIST_ITEMS) break
  }
  return subjects
}

function omitPollution(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value }
  for (const key of GENERATION_SPEC_POLLUTION_KEYS) delete copy[key]
  delete copy.roleConstraints
  delete copy.styleConstraints
  delete copy.prompt
  return copy
}

export function sanitizeGenerationSpecPatch(
  raw: unknown,
  lockedRole?: PersonalAssetRole
): GenerationSpecPatch {
  const record = asRecord(raw)
  if (!record) return lockedRole ? { assetRole: lockedRole } : {}
  const safe = omitPollution(record)
  const patch: GenerationSpecPatch = {}

  if (lockedRole) patch.assetRole = lockedRole
  else if (PERSONAL_ASSET_ROLES.includes(safe.assetRole as PersonalAssetRole)) {
    patch.assetRole = safe.assetRole as PersonalAssetRole
  }

  const contentRaw = asRecord(safe.content) ?? safe
  const content: NonNullable<GenerationSpecPatch['content']> = {}
  const subjects = cleanSubjects(contentRaw.primarySubjects)
  if (subjects.length) content.primarySubjects = subjects

  const colors = cleanStringList(contentRaw.preferredColors, MAX_COLOR_CHARS)
  if (colors.length) content.preferredColors = colors

  const action = cleanText(contentRaw.actionOrRelationship, MAX_ACTION_CHARS)
  if (action) content.actionOrRelationship = action

  const forbidden = cleanStringList(contentRaw.forbiddenElements, MAX_NAME_CHARS)
  if (forbidden.length) content.forbiddenElements = forbidden

  const required = cleanStringList(contentRaw.requiredElements, MAX_NAME_CHARS)
  if (required.length) content.requiredElements = required

  const environment = cleanText(contentRaw.environmentDescription, MAX_ENV_CHARS)
  if (environment) content.environmentDescription = environment

  if (Object.keys(content).length) patch.content = content
  return patch
}

export function patchHasContent(patch: GenerationSpecPatch): boolean {
  const content = patch.content
  if (!content) return false
  return Boolean(
    content.primarySubjects?.length ||
      content.actionOrRelationship?.trim() ||
      content.preferredColors?.length ||
      content.forbiddenElements?.length ||
      content.requiredElements?.length ||
      content.environmentDescription?.trim()
  )
}

function mergeStringList(current: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (!incoming?.length) return current
  const merged = [...(current ?? []), ...incoming].map((item) => item.trim()).filter(Boolean)
  return [...new Set(merged)]
}

function mergeSubjects(
  current: GenerationSubject[] | undefined,
  incoming: GenerationSubject[] | undefined
): GenerationSubject[] | undefined {
  if (!incoming?.length) return current
  const byName = new Map((current ?? []).map((subject) => [subject.name, subject]))
  for (const subject of incoming) {
    const previous = byName.get(subject.name)
    if (!previous) {
      byName.set(subject.name, subject)
      continue
    }
    byName.set(subject.name, {
      ...previous,
      ...subject,
      attributes: mergeStringList(previous.attributes, subject.attributes)
    })
  }
  return [...byName.values()]
}

const HOLDING_HINT = /抱|捧|举|抬|拿|带|提/

/**
 * Same-utterance local+LLM merge: keep the richer phrase; only stack when
 * one looks like posture and the other like holding.
 */
export function mergePatchActions(
  base: string | undefined,
  overlay: string | undefined
): string | undefined {
  const local = base?.trim()
  const remote = overlay?.trim()
  if (!remote) return local
  if (!local) return remote
  if (local === remote) return local
  if (local.includes(remote)) return local
  if (remote.includes(local)) return remote
  if (HOLDING_HINT.test(local) && HOLDING_HINT.test(remote)) {
    return local.length >= remote.length ? local : remote
  }
  return mergeActionOrRelationship(local, remote)
}

/** Overlay fills gaps; actions stack instead of wiping; lists union by name/value. */
export function mergeGenerationSpecPatches(
  base: GenerationSpecPatch,
  overlay: GenerationSpecPatch
): GenerationSpecPatch {
  const content: NonNullable<GenerationSpecPatch['content']> = {}
  const subjects = mergeSubjects(base.content?.primarySubjects, overlay.content?.primarySubjects)
  if (subjects?.length) content.primarySubjects = subjects

  const action = mergePatchActions(
    base.content?.actionOrRelationship,
    overlay.content?.actionOrRelationship
  )
  if (action) content.actionOrRelationship = action

  const colors = mergeStringList(base.content?.preferredColors, overlay.content?.preferredColors)
  if (colors?.length) content.preferredColors = colors

  const forbidden = mergeStringList(base.content?.forbiddenElements, overlay.content?.forbiddenElements)
  if (forbidden?.length) content.forbiddenElements = forbidden

  const required = mergeStringList(base.content?.requiredElements, overlay.content?.requiredElements)
  if (required?.length) content.requiredElements = required

  const environment =
    overlay.content?.environmentDescription?.trim() || base.content?.environmentDescription
  if (environment) content.environmentDescription = environment

  const patch: GenerationSpecPatch = {}
  const role = overlay.assetRole ?? base.assetRole
  if (role) patch.assetRole = role
  if (Object.keys(content).length) patch.content = content
  return patch
}

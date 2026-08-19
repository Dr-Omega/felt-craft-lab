import {
  createEmptyGenerationSpec,
  defaultRoleConstraints,
  FELT_COMMON_STYLE_CONSTRAINTS,
  GENERATION_SPEC_POLLUTION_KEYS,
  type GenerationContentSpec,
  type GenerationSpec,
  type GenerationSpecPatch
} from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'

function omitPollution<T extends object>(value: T): T {
  const copy = { ...value } as T & Record<string, unknown>
  for (const key of GENERATION_SPEC_POLLUTION_KEYS) {
    delete copy[key]
  }
  delete copy.roleConstraints
  delete copy.styleConstraints
  delete copy.prompt
  return copy
}

function mergeStringList(current: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (incoming === undefined) return current
  const merged = [...(current ?? []), ...incoming].map((item) => item.trim()).filter(Boolean)
  return [...new Set(merged)]
}

const POSTURE_PHRASE =
  /(坐在地上|坐在[^，。！？\s]{0,8}|站在[^，。！？\s]{0,8}|坐着|站着|躺着|跪着|蹲着|漂在[^，。！？\s]{0,8})/
const HOLDING_HINT = /抱|捧|举|抬|拿|带|提/

function extractPosturePhrase(text: string): string | null {
  const match = text.match(POSTURE_PHRASE)
  return match?.[0] ?? null
}

function hasHolding(text: string): boolean {
  return HOLDING_HINT.test(text)
}

/**
 * Supplements must stack on the previous action, not wipe it.
 * e.g. 抱着皮球 + 坐在地上 / 这个熊猫坐在地上 → 坐在地上抱着皮球
 */
export function mergeActionOrRelationship(
  current: string | undefined,
  incoming: string | undefined
): string | undefined {
  if (incoming === undefined) return current
  const next = incoming.trim()
  if (!next) return current
  const cur = current?.trim() ?? ''
  if (!cur) return next
  if (cur === next) return cur

  const nextPosture = extractPosturePhrase(next)
  const curPosture = extractPosturePhrase(cur)

  // Posture-only (or "熊猫坐在地上") supplement onto an existing holding action.
  if (nextPosture && hasHolding(cur) && !hasHolding(next)) {
    if (cur.includes(nextPosture)) return cur
    return `${nextPosture}${cur}`
  }

  // Holding supplement onto an existing posture.
  if (hasHolding(next) && curPosture && !hasHolding(cur)) {
    if (next.includes(curPosture)) return next
    return `${curPosture}${next}`
  }

  if (cur.includes(next)) return cur
  // Only allow a longer phrase to replace when it already contains the old action.
  if (next.includes(cur) && next.length > cur.length) return next

  if (nextPosture && curPosture && nextPosture !== curPosture && hasHolding(cur)) {
    return `${nextPosture}${cur.replace(curPosture, '')}`
  }

  return `${cur}，${next}`
}

function mergeSubjects(
  current: GenerationContentSpec['primarySubjects'],
  incoming: GenerationContentSpec['primarySubjects'] | undefined
): GenerationContentSpec['primarySubjects'] {
  if (!incoming) return current
  const byName = new Map(current.map((subject) => [subject.name, subject]))
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

function mergeContent(
  current: GenerationContentSpec,
  incoming: GenerationSpecPatch['content']
): GenerationContentSpec {
  if (!incoming) return current
  const next: GenerationContentSpec = {
    primarySubjects: mergeSubjects(current.primarySubjects, incoming.primarySubjects),
    actionOrRelationship: mergeActionOrRelationship(
      current.actionOrRelationship,
      incoming.actionOrRelationship
    ),
    preferredColors: mergeStringList(current.preferredColors, incoming.preferredColors),
    requiredElements: mergeStringList(current.requiredElements, incoming.requiredElements),
    forbiddenElements: mergeStringList(current.forbiddenElements, incoming.forbiddenElements),
    environmentDescription:
      incoming.environmentDescription === undefined
        ? current.environmentDescription
        : incoming.environmentDescription
  }
  return next
}

function withRole(spec: GenerationSpec, role: PersonalAssetRole): GenerationSpec {
  if (spec.assetRole === role) return spec
  return {
    ...spec,
    assetRole: role,
    roleConstraints: defaultRoleConstraints(role),
    confirmation: { status: 'unconfirmed', confirmedAt: null }
  }
}

export function applyGenerationSpecPatch(
  base: GenerationSpec,
  patch: GenerationSpecPatch
): GenerationSpec {
  const safePatch = omitPollution(patch)
  let next: GenerationSpec = {
    ...base,
    styleConstraints: { ...FELT_COMMON_STYLE_CONSTRAINTS },
    roleConstraints: defaultRoleConstraints(base.assetRole)
  }

  if (safePatch.assetRole) next = withRole(next, safePatch.assetRole)
  if (safePatch.creationMode) next = { ...next, creationMode: safePatch.creationMode }
  if (safePatch.themeContext === null) {
    const { themeContext: _removed, ...rest } = next
    next = rest
  } else if (safePatch.themeContext) {
    next = { ...next, themeContext: { ...next.themeContext, ...safePatch.themeContext } }
  }
  next = { ...next, content: mergeContent(next.content, safePatch.content) }
  next = {
    ...next,
    styleConstraints: { ...FELT_COMMON_STYLE_CONSTRAINTS },
    roleConstraints: defaultRoleConstraints(next.assetRole),
    confirmation: { status: 'unconfirmed', confirmedAt: null }
  }
  return next
}

export function specFromLockedRole(role: PersonalAssetRole): GenerationSpec {
  return createEmptyGenerationSpec(role)
}

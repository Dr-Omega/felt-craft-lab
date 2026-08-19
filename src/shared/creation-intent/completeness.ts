import type { GenerationSpec } from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'
import type { PlanFieldKey } from './plan-card'

export type CompletenessStatus = 'READY_TO_CONFIRM' | 'NEEDS_CLARIFICATION' | 'USE_DEFAULTS'

export interface CompletenessResult {
  status: CompletenessStatus
  missingFields: string[]
  criticalFields: string[]
}

function hasNamedSubject(spec: GenerationSpec): boolean {
  return spec.content.primarySubjects.some((subject) => subject.name.trim().length > 0)
}

function hasAnyColor(spec: GenerationSpec): boolean {
  if ((spec.content.preferredColors ?? []).some((item) => item.trim().length > 0)) return true
  return spec.content.primarySubjects.some(
    (subject) => (subject.attributes ?? []).some((item) => item.trim().length > 0)
  )
}

function criticalFieldsFor(role: PersonalAssetRole, spec: GenerationSpec): string[] {
  const missing: string[] = []
  if (role === 'background') {
    if (!spec.content.environmentDescription?.trim() && !hasNamedSubject(spec)) {
      missing.push('content.environmentDescription')
    }
    return missing
  }
  if (!hasNamedSubject(spec)) missing.push('content.primarySubjects')
  return missing
}

/**
 * Soft gaps for guided clarification. Order = ask priority.
 * Required / forbidden / scene stay visible on the plan card but are not
 * auto-asked (children can fill them via「再补一句」).
 */
function softMissingFields(role: PersonalAssetRole, spec: GenerationSpec): PlanFieldKey[] {
  const missing: PlanFieldKey[] = []
  if (role === 'background') {
    if (!spec.content.environmentDescription?.trim() && !hasNamedSubject(spec)) {
      missing.push('content.environmentDescription')
    }
    return missing
  }

  if (!hasNamedSubject(spec)) missing.push('content.primarySubjects')
  if (role === 'core_pattern' && !spec.content.actionOrRelationship?.trim()) {
    missing.push('content.actionOrRelationship')
  }
  if (role === 'core_pattern' && !hasAnyColor(spec)) {
    missing.push('content.preferredColors')
  }
  return missing
}

export function evaluateGenerationSpecCompleteness(spec: GenerationSpec): CompletenessResult {
  const criticalFields = criticalFieldsFor(spec.assetRole, spec)
  const soft = softMissingFields(spec.assetRole, spec)
  const missingFields = [...new Set([...criticalFields, ...soft])]

  if (criticalFields.length === 0 && missingFields.length === 0) {
    return { status: 'READY_TO_CONFIRM', missingFields: [], criticalFields: [] }
  }
  return { status: 'NEEDS_CLARIFICATION', missingFields, criticalFields }
}

import type { GenerationSpec } from '../contracts/generation-spec'
import { validateGenerationSpec } from '../contracts/validation'
import { evaluateGenerationSpecCompleteness } from './completeness'

export type ConfirmGenerationSpecFailureReason = 'NOT_READY' | 'INVALID_SPEC'

export type ConfirmGenerationSpecResult =
  | { ok: true; value: GenerationSpec }
  | { ok: false; reason: ConfirmGenerationSpecFailureReason }

/**
 * Marks a GenerationSpec confirmed. Compilation is refused until this succeeds.
 */
export function confirmGenerationSpec(
  spec: GenerationSpec,
  confirmedAt: string = new Date().toISOString()
): ConfirmGenerationSpecResult {
  const validated = validateGenerationSpec(spec)
  if (!validated.ok) return { ok: false, reason: 'INVALID_SPEC' }

  const completeness = evaluateGenerationSpecCompleteness(spec)
  if (completeness.criticalFields.length > 0) {
    return { ok: false, reason: 'NOT_READY' }
  }

  return {
    ok: true,
    value: {
      ...spec,
      clarification: { ...spec.clarification, pendingField: null },
      confirmation: { status: 'confirmed', confirmedAt }
    }
  }
}

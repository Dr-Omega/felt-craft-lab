import type { CanonicalPrompt } from './canonical'
import {
  generationSizeForRole,
  type ProviderPromptPayload
} from '../contracts/generation-candidate'

/**
 * Deterministic adapter: Canonical Prompt → provider-facing fields.
 * Does not call any model; adapters later may rewrite wording only.
 */
export function toProviderPromptPayload(prompt: CanonicalPrompt): ProviderPromptPayload {
  const size = generationSizeForRole(prompt.assetRole)
  return {
    positiveText: prompt.positiveText,
    negativeText: prompt.negativeText,
    width: size.width,
    height: size.height
  }
}

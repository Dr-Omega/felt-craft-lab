import type { GenerationSpecPatch } from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'

/**
 * LLM (or a test double) may only emit a domain patch.
 * It must not return Prompt text, Provider names, or model parameters.
 */
export interface CreationIntentParseInput {
  text: string
  lockedRole?: PersonalAssetRole
  /** When answering a clarification question, bind the utterance to this field. */
  pendingField?: string | null
}

export interface CreationIntentParser {
  parse(input: CreationIntentParseInput): Promise<GenerationSpecPatch>
}

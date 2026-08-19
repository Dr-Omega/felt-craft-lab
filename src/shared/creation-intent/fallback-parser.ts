import type { GenerationSpecPatch } from '../contracts/generation-spec'
import type { CreationIntentParseInput, CreationIntentParser } from './parser'
import { mergeGenerationSpecPatches, patchHasContent, sanitizeGenerationSpecPatch } from './sanitize-patch'

export class FallbackCreationIntentParser implements CreationIntentParser {
  constructor(
    private readonly options: {
      primary: CreationIntentParser
      fallback: CreationIntentParser
    }
  ) {}

  async parse(input: CreationIntentParseInput): Promise<GenerationSpecPatch> {
    const fallbackPatch = await this.options.fallback.parse(input)
    try {
      const primaryPatch = sanitizeGenerationSpecPatch(
        await this.options.primary.parse(input),
        input.lockedRole
      )
      if (!patchHasContent(primaryPatch)) return fallbackPatch
      return mergeGenerationSpecPatches(fallbackPatch, primaryPatch)
    } catch {
      return fallbackPatch
    }
  }
}

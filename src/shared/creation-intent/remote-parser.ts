import type { GenerationSpecPatch } from '../contracts/generation-spec'
import type { CreationIntentParseInput, CreationIntentParser } from './parser'
import { sanitizeGenerationSpecPatch } from './sanitize-patch'

export function extractCreationIntentPatch(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const record = body as Record<string, unknown>
  if (record.ok === true && record.result && typeof record.result === 'object' && !Array.isArray(record.result)) {
    const result = record.result as Record<string, unknown>
    return result.patch ?? result
  }
  return record.patch ?? record
}

export class RemoteCreationIntentParser implements CreationIntentParser {
  constructor(private readonly parseRemote: (input: CreationIntentParseInput) => Promise<unknown>) {}

  async parse(input: CreationIntentParseInput): Promise<GenerationSpecPatch> {
    const body = await this.parseRemote(input)
    return sanitizeGenerationSpecPatch(extractCreationIntentPatch(body), input.lockedRole)
  }
}

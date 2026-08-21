import type { GenerationSpecPatch } from '../contracts/generation-spec'
import type { CreationIntentParseInput, CreationIntentParser } from './parser'
import { CreationIntentBlockedError } from './blocked'
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

/** Gateway / provider signal that this utterance must not be locally reinterpreted. */
export function readCreationIntentBlockedMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (record.ok !== false) return null
  const error = record.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const code = (error as Record<string, unknown>).code
  if (code !== 'QA_BLOCKED') return null
  const message = (error as Record<string, unknown>).message
  return typeof message === 'string' && message.trim()
    ? message.trim()
    : '这句话不太适合画，请换一个想法。'
}

export class RemoteCreationIntentParser implements CreationIntentParser {
  constructor(private readonly parseRemote: (input: CreationIntentParseInput) => Promise<unknown>) {}

  async parse(input: CreationIntentParseInput): Promise<GenerationSpecPatch> {
    const body = await this.parseRemote(input)
    const blocked = readCreationIntentBlockedMessage(body)
    if (blocked) throw new CreationIntentBlockedError(blocked)
    return sanitizeGenerationSpecPatch(extractCreationIntentPatch(body), input.lockedRole)
  }
}

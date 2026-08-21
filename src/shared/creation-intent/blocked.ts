/** Fail-closed: blocked utterances must not fall through to local heuristics. */
export class CreationIntentBlockedError extends Error {
  readonly code = 'QA_BLOCKED' as const

  constructor(message = '这句话不太适合画，请换一个想法。') {
    super(message)
    this.name = 'CreationIntentBlockedError'
  }
}

export function isCreationIntentBlockedError(error: unknown): error is CreationIntentBlockedError {
  return error instanceof CreationIntentBlockedError
}

/** Shared reject cues for local + remote intent safety (Chinese substrings). */
export const CREATION_INTENT_REJECT_PATTERNS = [
  /自杀/,
  /色情/,
  /暴力杀人/,
  /炸弹/,
  /毒品/,
  /赌博/
] as const

export function isBlockedCreationIntentText(text: string): boolean {
  const source = text.trim()
  if (!source) return false
  return CREATION_INTENT_REJECT_PATTERNS.some((pattern) => pattern.test(source))
}

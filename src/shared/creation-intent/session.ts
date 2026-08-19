import type { GenerationCandidate } from '../contracts/generation-candidate'
import type { GenerationSpec } from '../contracts/generation-spec'
import type { PersonalAssetRole } from '../contracts/personal-asset'
import { createEmptyGenerationSpec } from '../contracts/generation-spec'
import type { CanonicalPrompt } from '../prompt-compiler/canonical'
import { compileCanonicalPrompt } from '../prompt-compiler/canonical'
import { applyDecideForMe, decideClarification, type ClarificationQuestion } from './clarification'
import { confirmGenerationSpec } from './confirm'
import type { CreationIntentParser } from './parser'
import { applyGenerationSpecPatch } from './patch'

export const CREATION_SESSION_PHASES = [
  'collecting',
  'awaiting_clarification',
  'ready_to_confirm',
  'confirmed',
  'compiled',
  'generated',
  'accepted'
] as const
export type CreationSessionPhase = (typeof CREATION_SESSION_PHASES)[number]

export interface CreationSessionSnapshot {
  phase: CreationSessionPhase
  spec: GenerationSpec
  question: ClarificationQuestion | null
  prompt: CanonicalPrompt | null
  candidate: GenerationCandidate | null
}

export interface CreationSessionOptions {
  parser: CreationIntentParser
  lockedRole?: PersonalAssetRole
}

function snapshot(
  spec: GenerationSpec,
  question: ClarificationQuestion | null,
  prompt: CanonicalPrompt | null,
  candidate: GenerationCandidate | null
): CreationSessionSnapshot {
  let phase: CreationSessionPhase = 'collecting'
  if (candidate?.status === 'ACCEPTED') phase = 'accepted'
  else if (candidate) phase = 'generated'
  else if (prompt) phase = 'compiled'
  else if (spec.confirmation.status === 'confirmed') phase = 'confirmed'
  else if (question) phase = 'awaiting_clarification'
  else if (spec.content.primarySubjects.length > 0 || spec.content.environmentDescription) {
    phase = 'ready_to_confirm'
  }
  return { phase, spec, question, prompt, candidate }
}

export class CreationIntentSession {
  private readonly parser: CreationIntentParser
  private readonly lockedRole?: PersonalAssetRole
  private spec: GenerationSpec
  private question: ClarificationQuestion | null = null
  private prompt: CanonicalPrompt | null = null
  private candidate: GenerationCandidate | null = null

  constructor(options: CreationSessionOptions) {
    this.parser = options.parser
    this.lockedRole = options.lockedRole
    this.spec = createEmptyGenerationSpec(options.lockedRole ?? 'core_pattern')
  }

  getSnapshot(): CreationSessionSnapshot {
    return snapshot(this.spec, this.question, this.prompt, this.candidate)
  }

  async submitText(text: string): Promise<CreationSessionSnapshot> {
    const pendingField = this.spec.clarification.pendingField
    const patch = await this.parser.parse({
      text,
      ...(this.lockedRole ? { lockedRole: this.lockedRole } : {}),
      ...(pendingField ? { pendingField } : {})
    })
    this.spec = applyGenerationSpecPatch(this.spec, patch)
    this.prompt = null
    this.candidate = null
    return this.refreshAfterContentChange()
  }

  decideForMe(): CreationSessionSnapshot {
    this.spec = applyDecideForMe(this.spec)
    this.prompt = null
    this.candidate = null
    this.question = null
    return this.refreshAfterContentChange()
  }

  confirm(confirmedAt: string = new Date().toISOString()): CreationSessionSnapshot {
    const confirmed = confirmGenerationSpec(this.spec, confirmedAt)
    if (!confirmed.ok) return this.getSnapshot()
    this.spec = confirmed.value
    this.question = null
    const compiled = compileCanonicalPrompt(this.spec)
    this.prompt = compiled.ok ? compiled.value : null
    this.candidate = null
    return this.getSnapshot()
  }

  attachCandidate(candidate: GenerationCandidate): CreationSessionSnapshot {
    this.candidate = candidate
    return this.getSnapshot()
  }

  clearCandidateForRedraw(): CreationSessionSnapshot {
    this.candidate = null
    return this.getSnapshot()
  }

  markCandidateAccepted(): CreationSessionSnapshot {
    if (!this.candidate) return this.getSnapshot()
    this.candidate = { ...this.candidate, status: 'ACCEPTED' }
    return this.getSnapshot()
  }

  private refreshAfterContentChange(): CreationSessionSnapshot {
    const decision = decideClarification(this.spec)
    this.spec = decision.spec
    if (decision.status === 'NEEDS_CLARIFICATION') {
      this.question = decision.question
      this.prompt = null
      this.candidate = null
      return this.getSnapshot()
    }
    this.question = null
    return this.getSnapshot()
  }
}

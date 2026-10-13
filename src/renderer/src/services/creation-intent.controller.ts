import type { GenerationQualityReport, GenerationSpec } from '@shared/contracts'
import { createEmptyGenerationSpec } from '@shared/contracts'
import {
  buildCreationPlanFields,
  CLARIFICATION_CHOICES,
  EMPTY_PLAN_HINT,
  planHasAnyContent,
  subjectLinesFromSpec,
  type CreationIntentAccepted,
  type CreationIntentIpcResult,
  type CreationPlanField,
  type CreationSessionPhase,
  type CreationSessionSnapshot
} from '@shared/creation-intent'
import { persistAcceptedGeneration } from '../persistence'
import { creationIntentClient } from './creation-intent.client'

export const CREATION_ASSET_ROLE = 'core_pattern' as const

export type PersistAcceptedGenerationFn = typeof persistAcceptedGeneration

export type CreationIntentUiClient = {
  start: typeof creationIntentClient.start
  submitText: typeof creationIntentClient.submitText
  confirm: typeof creationIntentClient.confirm
  decideForMe: typeof creationIntentClient.decideForMe
  regenerate: typeof creationIntentClient.regenerate
  accept: typeof creationIntentClient.accept
}

export interface CreationPlanView {
  fields: CreationPlanField[]
  /** One line per subject with its own colors, e.g. 黑白熊猫 / 红色皮球 */
  subjectLines: string[]
  action: string
  /** Only colors that are not already bound to a subject */
  extraColors: string
  required: string
  forbidden: string
  environment: string
}

export function planFromSpec(
  spec: GenerationSpec,
  pendingField: string | null = null
): CreationPlanView {
  const fields = buildCreationPlanFields(spec, pendingField)
  const byKey = Object.fromEntries(fields.map((field) => [field.key, field.value])) as Record<
    string,
    string
  >
  const bound = new Set(
    spec.content.primarySubjects.flatMap((subject) => subject.attributes ?? []).map((item) => item.trim())
  )
  const extraColors = (spec.content.preferredColors ?? [])
    .map((item) => item.trim())
    .filter((item) => item && !bound.has(item))
    .join('、')
  return {
    fields,
    subjectLines: subjectLinesFromSpec(spec),
    action: byKey['content.actionOrRelationship'] ?? '',
    extraColors,
    required: byKey['content.requiredElements'] ?? '',
    forbidden: byKey['content.forbiddenElements'] ?? '',
    environment: byKey['content.environmentDescription'] ?? ''
  }
}

export function summarizeCreationSpec(spec: GenerationSpec): string {
  const plan = planFromSpec(spec)
  return [...plan.subjectLines, plan.action].filter(Boolean).join('，')
}

function emptyPlan(): CreationPlanView {
  return planFromSpec(createEmptyGenerationSpec(CREATION_ASSET_ROLE), null)
}

export type CreationRetryAction = 'submit' | 'confirm' | 'regenerate' | 'accept' | 'decide'

export class CreationIntentController {
  readonly role = CREATION_ASSET_ROLE
  sessionId = ''
  text = ''
  phase: CreationSessionPhase | 'idle' = 'idle'
  question: string | null = null
  questionField: string | null = null
  choices: string[] = []
  plan: CreationPlanView = emptyPlan()
  summary = ''
  /** Kept for diagnostics/tests; CreateAssetPage must not show raw prompt to children. */
  positiveText: string | null = null
  negativeText: string | null = null
  candidateRef: string | null = null
  quality: GenerationQualityReport | null = null
  accepted: CreationIntentAccepted | null = null
  error: string | null = null
  busy = false
  busyHint: string | null = null
  /** Set when the last network/action failed so the UI can offer「再试一次」. */
  retryAction: CreationRetryAction | null = null
  private lastSubmittedText = ''
  private lastUtteranceForRetry = ''

  constructor(
    private readonly client: CreationIntentUiClient = creationIntentClient,
    private readonly persistAccepted: PersistAcceptedGenerationFn = persistAcceptedGeneration
  ) {}

  get hasPlan(): boolean {
    return planHasAnyContent(this.plan.fields)
  }

  get showPlanCard(): boolean {
    return this.phase !== 'idle' || this.hasPlan
  }

  get emptyPlanHint(): string {
    return EMPTY_PLAN_HINT
  }

  get canAccept(): boolean {
    return Boolean(this.sessionId && this.candidateRef && !this.accepted)
  }

  get canRetry(): boolean {
    return Boolean(this.error && this.retryAction && !this.busy)
  }

  async acceptUtterance(raw: string): Promise<void> {
    const next = raw.trim()
    if (!next) {
      this.error = this.hasPlan ? '请先写要补的那一句。' : '请先说想画什么。'
      this.retryAction = null
      return
    }
    if (this.hasPlan && next === this.lastSubmittedText) {
      this.error = '这句话已记下，请补充新内容。'
      this.retryAction = null
      return
    }
    this.text = next
    this.lastUtteranceForRetry = next
    await this.submitUtterance(next)
  }

  async submitCurrentText(): Promise<void> {
    await this.acceptUtterance(this.text)
  }

  private async submitUtterance(text: string): Promise<void> {
    await this.run('submit', async () => {
      if (!this.sessionId) {
        const started = await this.client.start({ lockedRole: CREATION_ASSET_ROLE })
        if (!this.applyResult(started)) return
      }
      if (!this.applyResult(await this.client.submitText({ sessionId: this.sessionId, text }))) return
      this.lastSubmittedText = text
      // Clear the box so “再补一句” means typing a new supplement, not resubmitting the same line.
      this.text = ''
    }, '正在整理描述…')
  }

  async confirmPlan(): Promise<void> {
    if (!this.sessionId) {
      this.error = '请先说想画什么。'
      this.retryAction = null
      return
    }
    if (this.phase !== 'ready_to_confirm') {
      this.error = this.question ? '还缺一点，请先回答上面那句。' : '请先说想画什么。'
      this.retryAction = null
      return
    }
    await this.run('confirm', async () => {
      this.applyResult(await this.client.confirm({ sessionId: this.sessionId }))
    }, '正在画图…')
  }

  async decideForMe(): Promise<void> {
    if (!this.sessionId) {
      this.error = '请先说想画什么。'
      this.retryAction = null
      return
    }
    await this.run('decide', async () => {
      this.applyResult(await this.client.decideForMe({ sessionId: this.sessionId }))
    })
  }

  /** Keep the confirmed plan; only draw a new candidate image. */
  async redrawCandidate(): Promise<void> {
    if (!this.sessionId) {
      this.error = '请先说想画什么。'
      this.retryAction = null
      return
    }
    await this.run('regenerate', async () => {
      this.applyResult(await this.client.regenerate({ sessionId: this.sessionId }))
    }, '正在再画一张…')
  }

  async acceptCandidate(): Promise<void> {
    if (!this.sessionId) {
      this.error = '请先说想画什么。'
      this.retryAction = null
      return
    }
    await this.run('accept', async () => {
      const result = await this.client.accept({ sessionId: this.sessionId })
      if (!this.applyResult(result)) return
      if (!result.ok || !result.accepted) return
      await this.persistAccepted(result.accepted)
      this.accepted = result.accepted
    }, '正在打开作品…')
  }

  async retryLastFailure(): Promise<void> {
    const action = this.retryAction
    if (!action || this.busy) return
    if (action === 'submit') {
      const text = this.lastUtteranceForRetry.trim() || this.text.trim()
      if (!text) {
        this.error = '请先写要补的那一句。'
        return
      }
      await this.submitUtterance(text)
      return
    }
    if (action === 'confirm') {
      await this.confirmPlan()
      return
    }
    if (action === 'regenerate') {
      await this.redrawCandidate()
      return
    }
    if (action === 'accept') {
      await this.acceptCandidate()
      return
    }
    if (action === 'decide') {
      await this.decideForMe()
    }
  }

  reset(): void {
    this.sessionId = ''
    this.text = ''
    this.phase = 'idle'
    this.question = null
    this.questionField = null
    this.choices = []
    this.plan = emptyPlan()
    this.summary = ''
    this.positiveText = null
    this.negativeText = null
    this.candidateRef = null
    this.quality = null
    this.accepted = null
    this.error = null
    this.busy = false
    this.busyHint = null
    this.retryAction = null
    this.lastSubmittedText = ''
    this.lastUtteranceForRetry = ''
  }

  private async run(
    action: CreationRetryAction,
    work: () => Promise<void>,
    hint: string | null = null
  ): Promise<void> {
    this.busy = true
    this.busyHint = hint
    this.error = null
    this.retryAction = null
    try {
      await work()
      if (this.error) this.retryAction = action
    } catch (error) {
      this.error = error instanceof Error ? error.message : '创作暂时无法完成，请稍后重试。'
      this.retryAction = action
    } finally {
      this.busy = false
      this.busyHint = null
    }
  }

  private applyResult(result: CreationIntentIpcResult): boolean {
    if (!result.ok) {
      this.error = result.error.message
      return false
    }
    this.sessionId = result.sessionId
    this.applySnapshot(result.snapshot)
    return true
  }

  private applySnapshot(snapshot: CreationSessionSnapshot): void {
    this.phase = snapshot.phase
    this.question = snapshot.question?.text ?? null
    this.questionField = snapshot.question?.field ?? null
    this.choices = this.questionField ? (CLARIFICATION_CHOICES[this.questionField] ?? []) : []
    this.plan = planFromSpec(snapshot.spec, this.questionField)
    this.summary = summarizeCreationSpec(snapshot.spec)
    this.positiveText = snapshot.prompt?.positiveText ?? null
    this.negativeText = snapshot.prompt?.negativeText ?? null
    this.candidateRef = snapshot.candidate?.temporaryRef ?? null
    this.quality = snapshot.candidate?.quality ?? null
    if (snapshot.candidate?.status !== 'ACCEPTED') this.accepted = null
  }
}

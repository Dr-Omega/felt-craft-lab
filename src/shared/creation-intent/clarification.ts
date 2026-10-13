import {
  DEFAULT_CLARIFICATION_MAX_ROUNDS,
  HARD_CLARIFICATION_MAX_ROUNDS,
  type GenerationSpec
} from '../contracts/generation-spec'
import { evaluateGenerationSpecCompleteness, type CompletenessStatus } from './completeness'

export interface ClarificationQuestion {
  field: string
  text: string
}

export interface ClarificationDecision {
  status: CompletenessStatus
  question: ClarificationQuestion | null
  spec: GenerationSpec
}

const QUESTION_TEXT: Record<string, string> = {
  'content.primarySubjects': '你最想画的是谁，或者是什么东西呢？',
  'content.actionOrRelationship': '它在做什么，还是和谁在一起呢？',
  'content.preferredColors': '想用什么颜色呢？',
  'content.requiredElements': '画面里还必须有什么吗？没有也可以说「没有」。',
  'content.environmentDescription': '它在什么地方？也可以不指定。',
  'content.forbiddenElements': '有什么是不要画出来的吗？'
}

export const CLARIFICATION_CHOICES: Record<string, string[]> = {
  'content.primarySubjects': ['玉兔', '熊猫', '荷花'],
  'content.actionOrRelationship': ['抱着月饼', '坐着', '站着'],
  'content.preferredColors': ['黑白', '红色', '白色'],
  'content.requiredElements': ['没有', '大眼睛', '围巾'],
  'content.environmentDescription': ['没有', '地上', '草地上']
}

/** Spoken answers that mean “skip this optional field”. */
const SKIP_PHRASES = new Set(['没有', '不用', '不要', '无', '随便', '你来定'])

export function isSkipClarificationAnswer(text: string): boolean {
  return SKIP_PHRASES.has(text.trim())
}

/**
 * Soft pending answers like「没有 / 随便」must clear the question without writing
 * the skip phrase into the field. Soft rounds stop so we do not re-ask.
 */
export function applySkipPendingAnswer(spec: GenerationSpec, pendingField: string): GenerationSpec {
  const askedFields = spec.clarification.askedFields.includes(pendingField)
    ? spec.clarification.askedFields
    : [...spec.clarification.askedFields, pendingField]
  return {
    ...spec,
    clarification: {
      roundCount: Math.max(spec.clarification.roundCount, DEFAULT_CLARIFICATION_MAX_ROUNDS),
      askedFields,
      pendingField: null
    }
  }
}

function questionFor(field: string): ClarificationQuestion {
  return {
    field,
    text: QUESTION_TEXT[field] ?? '还想再补充一点你最在意的地方吗？'
  }
}

function nextField(spec: GenerationSpec): string | null {
  const completeness = evaluateGenerationSpecCompleteness(spec)
  return completeness.missingFields[0] ?? completeness.criticalFields[0] ?? null
}

/**
 * Code, not the LLM, decides whether to ask, which field to ask, and when
 * to stop. The question text is a child-friendly template.
 */
export function decideClarification(spec: GenerationSpec): ClarificationDecision {
  const completeness = evaluateGenerationSpecCompleteness(spec)
  if (completeness.status === 'READY_TO_CONFIRM') {
    return {
      status: 'READY_TO_CONFIRM',
      question: null,
      spec: { ...spec, clarification: { ...spec.clarification, pendingField: null } }
    }
  }

  const field = nextField(spec)
  if (!field) {
    return { status: 'READY_TO_CONFIRM', question: null, spec }
  }

  if (spec.clarification.roundCount >= HARD_CLARIFICATION_MAX_ROUNDS) {
    return {
      status: 'USE_DEFAULTS',
      question: null,
      spec: { ...spec, clarification: { ...spec.clarification, pendingField: null } }
    }
  }

  if (
    spec.clarification.roundCount >= DEFAULT_CLARIFICATION_MAX_ROUNDS &&
    !completeness.criticalFields.includes(field)
  ) {
    return {
      status: 'USE_DEFAULTS',
      question: null,
      spec: { ...spec, clarification: { ...spec.clarification, pendingField: null } }
    }
  }

  return {
    status: 'NEEDS_CLARIFICATION',
    question: questionFor(field),
    spec: {
      ...spec,
      clarification: {
        roundCount: spec.clarification.roundCount + 1,
        askedFields: spec.clarification.askedFields.includes(field)
          ? spec.clarification.askedFields
          : [...spec.clarification.askedFields, field],
        pendingField: field
      }
    }
  }
}

export function applyDecideForMe(spec: GenerationSpec): GenerationSpec {
  return {
    ...spec,
    clarification: {
      ...spec.clarification,
      pendingField: null,
      // Skip remaining clarification rounds and fall through to defaults.
      roundCount: Math.max(spec.clarification.roundCount, HARD_CLARIFICATION_MAX_ROUNDS)
    }
  }
}

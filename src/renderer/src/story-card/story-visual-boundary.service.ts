import type { StoryCardDraft, StoryCardWorkContext } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'

const CORE_ACTION_TERMS = [
  '找朋友',
  '玩',
  '坐船',
  '飞',
  '跑',
  '跳',
  '睡觉',
  '吃',
  '唱歌',
  '画画',
  '游泳',
  '遇见',
  '帮助',
  '救',
  '变成',
  'find a friend',
  'play',
  'take a boat',
  'fly',
  'run',
  'jump',
  'sleep',
  'eat',
  'sing',
  'draw',
  'swim',
  'meet',
  'help',
  'save',
  'become'
] as const

function contextElementNames(context: StoryCardWorkContext): string[] {
  return [context.subject.name, context.background?.name, ...context.stickers.map((sticker) => sticker.name)].filter(
    (name): name is string => Boolean(name?.trim())
  )
}

function failed(workId: string, label: string, kind: '素材' | '情节'): StoryCardDraft {
  return {
    workId,
    status: 'failed',
    error: toSharedError(
      {
        code: 'QA_BLOCKED',
        message: `故事里出现了孩子还没有说过的${kind}“${label}”，请先听听孩子怎么说。`,
        retryable: false
      },
      'QA_BLOCKED'
    )
  }
}

function chineseDestinations(text: string): string[] {
  return Array.from(text.matchAll(/(?:去|到)([\u4e00-\u9fff]{1,4})(?=[，。！？、]|$)/g), (match) => match[1])
}

function englishDestinations(text: string): string[] {
  return Array.from(
    text.matchAll(/\b(?:go|went|travel|travelled|traveled|fly|flew|run|ran) to ([a-z]+(?:\s+[a-z]+){0,2})\b/giu),
    (match) => match[1].toLocaleLowerCase()
  )
}

function firstUnmentionedCoreEvent(sourceText: string, candidateText: string): string | undefined {
  const normalizedSourceText = sourceText.toLocaleLowerCase()
  const normalizedCandidateText = candidateText.toLocaleLowerCase()
  const action = CORE_ACTION_TERMS.find(
    (term) => normalizedCandidateText.includes(term.toLocaleLowerCase()) && !normalizedSourceText.includes(term.toLocaleLowerCase())
  )
  if (action) return action

  const sourceDestinations = new Set([...chineseDestinations(sourceText), ...englishDestinations(normalizedSourceText)])
  const destination = [...chineseDestinations(candidateText), ...englishDestinations(normalizedCandidateText)].find(
    (name) => !sourceDestinations.has(name)
  )
  return destination ? `去${destination}` : undefined
}

/**
 * Deterministic visual-boundary guard. It blocks concrete work-context element
 * names and core events that appear in a candidate title or story without appearing in the child input.
 */
export class StoryVisualBoundaryValidator {
  validate(sourceText: string, context: StoryCardWorkContext, draft: StoryCardDraft): StoryCardDraft {
    if (draft.status !== 'ready_for_review') return draft

    const candidateText = `${draft.suggestedTitle}\n${draft.suggestedStoryText}`
    const normalizedSourceText = sourceText.toLocaleLowerCase()
    const normalizedCandidateText = candidateText.toLocaleLowerCase()
    const unmentionedElement = contextElementNames(context).find(
      (name) => normalizedCandidateText.includes(name.toLocaleLowerCase()) && !normalizedSourceText.includes(name.toLocaleLowerCase())
    )
    if (unmentionedElement) return failed(draft.workId, unmentionedElement, '素材')

    const unmentionedEvent = firstUnmentionedCoreEvent(sourceText, candidateText)
    return unmentionedEvent ? failed(draft.workId, unmentionedEvent, '情节') : draft
  }
}

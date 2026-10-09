import type { StoryCardEditPayload, StoryCardWorkContext, UtcIso8601 } from '@shared/contracts'
import { persistenceError } from '../persistence/errors'

function isUtcIso8601Timestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

export type CurrentStoryCardWork = Pick<StoryCardWorkContext, 'workId' | 'artworkImageRef'>

export interface StoryCardFinalFields {
  editPayload: StoryCardEditPayload
  workContext: CurrentStoryCardWork
  confirmedAt: UtcIso8601
}

export function validateStoryCardFinalFields(fields: StoryCardFinalFields): void {
  if (fields.editPayload.workId !== fields.workContext.workId) {
    throw persistenceError('INVALID_ARGUMENT', '编辑内容必须属于当前作品。')
  }
  if (!fields.editPayload.title.trim()) {
    throw persistenceError('INVALID_ARGUMENT', '请填写故事标题后再确认。')
  }
  if (!fields.editPayload.storyText.trim()) {
    throw persistenceError('INVALID_ARGUMENT', '请填写故事内容后再确认。')
  }
  if (!isUtcIso8601Timestamp(fields.confirmedAt)) {
    throw persistenceError('INVALID_ARGUMENT', '确认日期格式无效。')
  }
}

import { describe, expect, it } from 'vitest'
import {
  friendlyUserError,
  isTransientDbError
} from '../../src/renderer/src/util/friendly-user-error'

describe('friendlyUserError', () => {
  it('maps IndexedDB UnknownError to friendly copy', () => {
    const error = new DOMException('Internal error.', 'UnknownError')
    expect(isTransientDbError(error)).toBe(true)
    expect(friendlyUserError(error)).toBe('本地存储暂时有点忙，请稍后再试。')
  })

  it('keeps intentional Chinese product messages', () => {
    expect(friendlyUserError(new Error('这个素材还没有解锁，先看看别的吧。'))).toBe(
      '这个素材还没有解锁，先看看别的吧。'
    )
    expect(friendlyUserError(new Error('请先选择作品主题'))).toBe('请先选择作品主题')
  })

  it('hides generic technical errors', () => {
    expect(friendlyUserError(new Error('Something failed badly'))).toBe('刚刚遇到一点小问题，请稍后再试。')
  })
})

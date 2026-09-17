import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../src/main/external-url'
import { APP_DISPLAY_NAME, APP_ID, IPC_CHANNELS } from '../src/shared/constants/app'
import { getServerBootstrapInfo } from '../server/index'

describe('project bootstrap smoke', () => {
  it('exposes stable app constants', () => {
    expect(APP_DISPLAY_NAME).toBe('Felt Craft Lab')
    expect(APP_ID).toBe('com.feltcraft.lab')
    expect(IPC_CHANNELS.PING).toBe('felt:bootstrap:ping')
    expect(IPC_CHANNELS.AI_TTS_SYNTHESIZE).toBe('felt:ai:tts:synthesize')
    expect(IPC_CHANNELS.IMAGE_UPLOAD).toBe('felt:image:upload')
  })

  it('keeps server as a non-ready shell', () => {
    const info = getServerBootstrapInfo()
    expect(info.ready).toBe(false)
    expect(info.name).toContain('felt-craft-lab')
  })

  it('only allows http and https external urls', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:5173')).toBe(true)
    expect(isAllowedExternalUrl('file:///C:/temp/x.txt')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('not-a-url')).toBe(false)
  })
})

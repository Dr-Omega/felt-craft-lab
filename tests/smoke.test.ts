import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME, APP_ID, IPC_CHANNELS } from '../src/shared/constants/app'
import { getServerBootstrapInfo } from '../server/index'

describe('project bootstrap smoke', () => {
  it('exposes stable app constants', () => {
    expect(APP_DISPLAY_NAME).toBe('Felt Craft Lab')
    expect(APP_ID).toBe('com.feltcraft.lab')
    expect(IPC_CHANNELS.PING).toBe('felt:bootstrap:ping')
  })

  it('keeps server as a non-ready shell', () => {
    const info = getServerBootstrapInfo()
    expect(info.ready).toBe(false)
    expect(info.name).toContain('felt-craft-lab')
  })
})

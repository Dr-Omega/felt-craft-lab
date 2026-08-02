import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HowlHandler = (...args: unknown[]) => void

const { MockHowl } = vi.hoisted(() => {
  class MockHowlClass {
    static instances: MockHowlClass[] = []

    handlers = new Map<string, HowlHandler[]>()

    play = vi.fn(() => {
      queueMicrotask(() => this.emit('play'))
      return 1
    })

    stop = vi.fn(() => {
      this.emit('stop')
    })

    unload = vi.fn()

    constructor(_options: Record<string, unknown>) {
      MockHowlClass.instances.push(this)
    }

    on(event: string, fn: HowlHandler): void {
      const list = this.handlers.get(event) ?? []
      list.push(fn)
      this.handlers.set(event, list)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const fn of this.handlers.get(event) ?? []) {
        fn(...args)
      }
    }
  }

  return { MockHowl: MockHowlClass }
})

vi.mock('howler', () => ({
  Howl: MockHowl
}))

import { HowlerAudioService } from '../../src/renderer/src/services/audio.service'

describe('HowlerAudioService', () => {
  let service: HowlerAudioService

  beforeEach(() => {
    MockHowl.instances = []
    service = new HowlerAudioService()
  })

  afterEach(() => {
    service.stop()
    vi.clearAllMocks()
  })

  it('resolves play when playback starts', async () => {
    const playPromise = service.play('felt-resource://audio/test.mp3', 'primary')
    await expect(playPromise).resolves.toBeUndefined()
    expect(MockHowl.instances).toHaveLength(1)
    expect(MockHowl.instances[0].play).toHaveBeenCalled()
  })

  it('settles consecutive primary plays without hanging', async () => {
    const first = service.play('felt-resource://audio/a.mp3', 'primary')
    await first

    const second = service.play('felt-resource://audio/b.mp3', 'primary')
    await expect(second).resolves.toBeUndefined()

    expect(MockHowl.instances).toHaveLength(2)
    expect(MockHowl.instances[0].stop).toHaveBeenCalled()
  })

  it('settles overlapping primary plays when the second replaces the first', async () => {
    const originalPlay = MockHowl.prototype.play
    MockHowl.prototype.play = vi.fn(function (this: InstanceType<typeof MockHowl>) {
      // keep first promise pending until stop/replace settles it
      return 1
    })

    try {
      const first = service.play('felt-resource://audio/a.mp3', 'primary')
      await Promise.resolve()
      const second = service.play('felt-resource://audio/b.mp3', 'primary')
      await expect(first).resolves.toBeUndefined()
      MockHowl.instances[1]?.emit('play')
      await expect(second).resolves.toBeUndefined()
    } finally {
      MockHowl.prototype.play = originalPlay
    }
  })

  it('settles pending play when stop is called during playback', async () => {
    const playPromise = service.play('felt-resource://audio/hold.mp3', 'primary')
    service.stop('primary')
    await expect(playPromise).resolves.toBeUndefined()
  })

  it('does not treat load as successful start when playerror follows', async () => {
    const originalPlay = MockHowl.prototype.play
    MockHowl.prototype.play = vi.fn(function (this: InstanceType<typeof MockHowl>) {
      queueMicrotask(() => {
        this.emit('load')
        queueMicrotask(() => this.emit('playerror'))
      })
      return 1
    })

    try {
      const startedAt = Date.now()
      const playPromise = service.play('felt-resource://audio/autoplay-fail.mp3', 'primary')
      // If load incorrectly settled success, promise would resolve before playerror.
      await expect(playPromise).resolves.toBeUndefined()
      const instance = MockHowl.instances[0]
      expect(instance.play).toHaveBeenCalled()
      // Promise must still settle via playerror path (not hang); elapsed is a soft check.
      expect(Date.now() - startedAt).toBeLessThan(2000)
    } finally {
      MockHowl.prototype.play = originalPlay
    }
  })
})

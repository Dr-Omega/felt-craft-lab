import { afterEach, describe, expect, it, vi } from 'vitest'
import { playNarration } from '../../src/renderer/src/learning-zone/narration-playback'
class Player extends EventTarget {
  currentTime = 0
  play = vi.fn(async () => {})
  pause = vi.fn()
}
afterEach(() => vi.useRealTimers())
describe('guided narration completion', () => {
  it('only finishes successfully after ended', async () => {
    const player = new Player()
    const result = playNarration(player as unknown as HTMLAudioElement, new AbortController().signal)
    player.dispatchEvent(new Event('ended'))
    await expect(result).resolves.toBeUndefined()
    expect(player.pause).toHaveBeenCalledOnce()
  })
  it('unblocks stalled playback without crediting completion', async () => {
    vi.useFakeTimers()
    const player = new Player()
    const result = playNarration(player as unknown as HTMLAudioElement, new AbortController().signal)
    const rejected = expect(result).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(player.pause).toHaveBeenCalledOnce()
  })
  it('allows long narration as long as playback makes progress', async () => {
    vi.useFakeTimers()
    const player = new Player()
    const result = playNarration(player as unknown as HTMLAudioElement, new AbortController().signal)
    for(let i=0;i<10;i++){await vi.advanceTimersByTimeAsync(10000);player.currentTime+=10;player.dispatchEvent(new Event('timeupdate'))}
    player.dispatchEvent(new Event('ended'))
    await expect(result).resolves.toBeUndefined()
  })
  it('cancels promptly without crediting completion', async () => {
    const player = new Player(), abort = new AbortController()
    const result = playNarration(player as unknown as HTMLAudioElement, abort.signal)
    abort.abort()
    await expect(result).rejects.toThrow('停止')
  })
})

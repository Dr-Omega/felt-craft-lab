/**
 * AudioService — Electron renderer 正式实现
 *
 * 规则（规范 9.4）：
 * - primary：主要朗读；新播放前先停旧的
 * - effect：操作音效；可与 primary 并行；可被总开关关闭
 * - 播放失败不抛到页面业务层
 * - play() 仅在 Howler `play` 事件（成功开始播放）时 resolve 为成功开始
 * - load 不算成功；loaderror/playerror/stop/替换时可靠 settle（不提前宣告 start）
 *
 * Electron 正式音频地址使用 ResourceRef：felt-resource://audio/...
 */

import { Howl } from 'howler'
import { toPlayableAudioUrl } from './audio-url'

export type AudioChannel = 'primary' | 'effect'

export interface AudioService {
  play(url: string, channel?: AudioChannel): Promise<void>
  stop(channel?: AudioChannel): void
  setEffectsEnabled(enabled: boolean): void
}

type HowlInstance = Howl

export class HowlerAudioService implements AudioService {
  private primary: HowlInstance | null = null
  private effect: HowlInstance | null = null
  private effectsEnabled = true
  private pendingPlay = new Map<AudioChannel, () => void>()

  async play(url: string, channel: AudioChannel = 'primary'): Promise<void> {
    if (!url) return
    if (channel === 'effect' && !this.effectsEnabled) return

    const playable = toPlayableAudioUrl(url)

    try {
      if (channel === 'primary') {
        this.stop('primary')
        this.primary = this.createHowl(playable)
        await this.playHowl(this.primary, 'primary')
        return
      }

      this.stop('effect')
      this.effect = this.createHowl(playable)
      await this.playHowl(this.effect, 'effect')
    } catch {
      this.settlePending(channel)
      console.warn('[AudioService] play failed:', url, '→', playable)
    }
  }

  stop(channel?: AudioChannel): void {
    if (!channel || channel === 'primary') {
      this.settlePending('primary')
      this.dispose('primary')
    }
    if (!channel || channel === 'effect') {
      this.settlePending('effect')
      this.dispose('effect')
    }
  }

  setEffectsEnabled(enabled: boolean): void {
    this.effectsEnabled = Boolean(enabled)
    if (!this.effectsEnabled) {
      this.stop('effect')
    }
  }

  private createHowl(url: string): HowlInstance {
    return new Howl({
      src: [url],
      html5: true,
      preload: true,
      format: url.includes('.mp3') ? ['mp3'] : undefined
    })
  }

  private playHowl(sound: HowlInstance, channel: AudioChannel): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        this.pendingPlay.delete(channel)
        resolve()
      }

      this.pendingPlay.set(channel, done)

      // Only `play` means playback started. `load` must not settle as success.
      sound.on('play', done)
      sound.on('loaderror', done)
      sound.on('playerror', done)
      sound.on('stop', done)

      try {
        sound.play()
      } catch {
        done()
      }
    })
  }

  private settlePending(channel: AudioChannel): void {
    const done = this.pendingPlay.get(channel)
    if (!done) return
    this.pendingPlay.delete(channel)
    done()
  }

  private dispose(channel: AudioChannel): void {
    const current = channel === 'primary' ? this.primary : this.effect
    if (!current) return
    try {
      current.stop()
      current.unload()
    } catch {
      // ignore
    }
    if (channel === 'primary') this.primary = null
    else this.effect = null
  }
}

export const audioService: AudioService = new HowlerAudioService()

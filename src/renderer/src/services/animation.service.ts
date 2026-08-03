/**
 * AnimationService — Electron renderer 正式实现
 *
 * play(eventKey, target?)
 * stop(eventKey?)
 *
 * 资源映射由 YWN 通过 setResourceMap 注入；生产环境不使用远程 LottieFiles URL。
 */

import lottie, { type AnimationItem } from 'lottie-web'

export type AnimationEventKey = 'collect' | 'save' | 'loading' | string

export interface AnimationService {
  play(eventKey: string, target?: HTMLElement | null): Promise<void>
  stop(eventKey?: string): void
  setResourceMap(map: Record<string, string>): void
}

/** 生产环境为空；YWN 交付后通过 setResourceMap 注入 */
export const DEFAULT_LOTTIE_MAP: Record<string, string> = {}

export class LottieAnimationService implements AnimationService {
  private running = new Map<string, AnimationItem>()
  private overlayHosts = new Map<string, HTMLElement>()
  private map: Record<string, string>

  constructor(map: Record<string, string> = DEFAULT_LOTTIE_MAP) {
    this.map = { ...map }
  }

  setResourceMap(map: Record<string, string>): void {
    this.map = { ...this.map, ...map }
  }

  async play(eventKey: string, target?: HTMLElement | null): Promise<void> {
    const path = this.map[eventKey]
    if (!path) {
      console.warn('[AnimationService] unknown eventKey (no resource map entry):', eventKey)
      return
    }

    this.stop(eventKey)

    const host = this.resolveHost(eventKey, target)
    const loop = eventKey === 'loading'

    try {
      const anim = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop,
        autoplay: true,
        path
      })
      this.running.set(eventKey, anim)

      if (loop) {
        return
      }

      await new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          this.stop(eventKey)
          resolve()
        }
        anim.addEventListener('complete', finish)
        setTimeout(finish, 4000)
      })
    } catch (e) {
      console.warn('[AnimationService] play failed:', eventKey, e)
      this.cleanupHost(eventKey)
    }
  }

  stop(eventKey?: string): void {
    if (!eventKey) {
      for (const key of [...this.running.keys()]) {
        this.stop(key)
      }
      return
    }
    const anim = this.running.get(eventKey)
    if (anim) {
      try {
        anim.stop()
        anim.destroy()
      } catch {
        // ignore
      }
      this.running.delete(eventKey)
    }
    this.cleanupHost(eventKey)
  }

  private resolveHost(eventKey: string, target?: HTMLElement | null): HTMLElement {
    if (target) return target

    let host = this.overlayHosts.get(eventKey)
    if (host && document.body.contains(host)) return host

    host = document.createElement('div')
    host.dataset.animKey = eventKey
    host.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'width:120px',
      'height:120px',
      'z-index:9999',
      'pointer-events:none'
    ].join(';')
    document.body.appendChild(host)
    this.overlayHosts.set(eventKey, host)
    return host
  }

  private cleanupHost(eventKey: string): void {
    const host = this.overlayHosts.get(eventKey)
    if (!host) return
    if (!host.dataset.animKey) return
    try {
      host.remove()
    } catch {
      // ignore
    }
    this.overlayHosts.delete(eventKey)
  }
}

export const animationService: AnimationService = new LottieAnimationService()

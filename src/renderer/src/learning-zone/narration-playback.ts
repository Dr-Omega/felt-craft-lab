/** Completion is credited only on ended, never on timeout, cancellation or media error. */
export function playNarration(player: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      player.removeEventListener('ended', ended)
      player.removeEventListener('error', failed)
      player.removeEventListener('timeupdate', progress)
      signal.removeEventListener('abort', cancelled)
      player.pause()
      if (error) reject(error)
      else resolve()
    }
    let lastTime = player.currentTime
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => finish(new Error('讲解加载或播放超时，请重播讲解。')), 15000) }
    const progress = () => { if (player.currentTime > lastTime) { lastTime = player.currentTime; arm() } }
    const ended = () => finish()
    const failed = () => finish(new Error('讲解播放失败，请重播讲解。'))
    const cancelled = () => finish(new Error('讲解已停止，可以重播。'))
    if (signal.aborted) { cancelled(); return }
    player.addEventListener('ended', ended)
    player.addEventListener('error', failed)
    player.addEventListener('timeupdate', progress)
    signal.addEventListener('abort', cancelled, { once: true })
    arm()
    void player.play().catch(() => failed())
  })
}

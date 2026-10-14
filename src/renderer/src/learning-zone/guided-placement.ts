import type { GameSession, GameSticker } from './game-client'

/** Use the Main validator's logical bounds and tolerance, never viewport pixels. */
export function acceptsGuidedDrop(sticker: GameSticker, bounds: GameSession['level']['canvasBounds'], rect: { left: number; top: number; width: number; height: number }, x: number, y: number): boolean {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false
  if (x < rect.left || x > rect.left + rect.width || y < rect.top || y > rect.top + rect.height) return false
  const px = bounds.minX + (x - rect.left) / rect.width * (bounds.maxX - bounds.minX)
  const py = bounds.minY + (y - rect.top) / rect.height * (bounds.maxY - bounds.minY)
  const a = sticker.targetArea, t = sticker.tolerance
  return px >= a.minX - t && px <= a.maxX + t && py >= a.minY - t && py <= a.maxY + t
}

export function guidedStepReady(placed: boolean, listening: boolean, busy: boolean, heard: readonly string[], expected: readonly string[]): boolean {
  return placed && !listening && !busy && heard.length === expected.length && heard.every((url, i) => url === expected[i])
}

export function formatStoryCardAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'

  const wholeSeconds = Math.floor(seconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const remainingSeconds = String(wholeSeconds % 60).padStart(2, '0')
  return `${minutes}:${remainingSeconds}`
}

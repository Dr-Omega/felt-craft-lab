export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Read a Fetch Response body with a hard byte budget.
 * Content-Length is an early reject only; chunked/missing length is enforced while streaming.
 * Never fully buffers an oversized body before rejecting.
 */
export async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<
  { ok: true; text: string } | { ok: false; reason: 'too_large' | 'aborted' | 'invalid' }
> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const n = Number(contentLength)
    if (Number.isFinite(n) && n > maxBytes) {
      try {
        await response.body?.cancel()
      } catch {
        // ignore
      }
      return { ok: false, reason: 'too_large' }
    }
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    // Extremely defensive fallback — still enforce after read.
    try {
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, reason: 'too_large' }
      return { ok: true, text }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel()
        return { ok: false, reason: 'aborted' }
      }
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // ignore
    }
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return { ok: false, reason: 'aborted' }
    }
    return { ok: false, reason: 'invalid' }
  }

  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  return { ok: true, text: merged.toString('utf8') }
}

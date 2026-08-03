import { describe, expect, it, vi } from 'vitest'
import { readResponseTextBounded } from '../../src/main/ai/read-response-bounded'
import {
  MAX_ASR_AUDIO_BASE64_CHARS,
  MAX_QA_CHARS,
  MAX_TTS_CHARS,
  validateAsrIpcInput,
  validateQaIpcInput,
  validateTtsIpcInput
} from '../../src/main/ai/input-guards'

function chunkedResponse(totalBytes: number, chunkSize: number, withContentLength = false): Response {
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkSize, totalBytes - sent)
      controller.enqueue(new Uint8Array(size).fill(65)) // 'A'
      sent += size
    }
  })
  const headers: Record<string, string> = {}
  if (withContentLength) headers['content-length'] = String(totalBytes)
  return new Response(stream, { status: 200, headers })
}

describe('readResponseTextBounded', () => {
  it('rejects Content-Length over budget without reading body', async () => {
    const cancel = vi.fn(async () => undefined)
    const body = {
      getReader: () => {
        throw new Error('should not read body when Content-Length rejects')
      },
      cancel
    } as unknown as ReadableStream<Uint8Array>
    const response = {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-length' ? '99999999' : null)
      },
      body
    } as unknown as Response

    const out = await readResponseTextBounded(response, 1024)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('too_large')
    expect(cancel).toHaveBeenCalled()
  })

  it('aborts chunked/no Content-Length responses before fully reading oversized body', async () => {
    const maxBytes = 8 * 1024
    const response = chunkedResponse(maxBytes * 4, 1024, false)
    let pulls = 0
    const originalGetReader = response.body!.getReader.bind(response.body)
    response.body!.getReader = () => {
      const reader = originalGetReader()
      const originalRead = reader.read.bind(reader)
      reader.read = async () => {
        pulls += 1
        return originalRead()
      }
      return reader
    }

    const out = await readResponseTextBounded(response, maxBytes)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('too_large')
    // Should stop after exceeding budget (~9 pulls of 1KiB), not read all 32KiB (~32 pulls).
    expect(pulls).toBeLessThan(20)
    expect(pulls).toBeGreaterThan(5)
  })

  it('accepts small chunked bodies', async () => {
    const response = chunkedResponse(100, 30, false)
    const out = await readResponseTextBounded(response, 1024)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.text.length).toBe(100)
  })
})

describe('Main IPC input guards', () => {
  it('rejects oversized ASR base64 before decode and bad mime', () => {
    expect(
      validateAsrIpcInput({
        audioBase64: 'A'.repeat(MAX_ASR_AUDIO_BASE64_CHARS + 1),
        mimeType: 'audio/wav'
      }).ok
    ).toBe(false)

    expect(
      validateAsrIpcInput({
        audioBase64: Buffer.from('hi').toString('base64'),
        mimeType: 'application/javascript'
      }).ok
    ).toBe(false)

    expect(
      validateAsrIpcInput({
        audioBase64: Buffer.from('hi').toString('base64'),
        mimeType: 'audio/wav'
      }).ok
    ).toBe(true)
  })

  it('rejects oversized QA/TTS text', () => {
    expect(validateQaIpcInput('x'.repeat(MAX_QA_CHARS + 1)).ok).toBe(false)
    expect(validateQaIpcInput('你好').ok).toBe(true)
    expect(validateTtsIpcInput('y'.repeat(MAX_TTS_CHARS + 1)).ok).toBe(false)
    expect(validateTtsIpcInput('朗读').ok).toBe(true)
  })
})

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteTemporaryStoryCardAudio,
  promoteTemporaryStoryCardAudio,
  readTemporaryStoryCardAudio,
  saveTemporaryStoryCardAudio
} from '../../src/main/story-card-audio/write'
import { resolveFeltResourcePath } from '../../src/shared/resource/resolve-path'
import type { ResourceRoots } from '../../src/shared/resource'

const temporaryDirectories: string[] = []

function makeRoots(): ResourceRoots {
  const root = mkdtempSync(join(tmpdir(), 'felt-story-card-audio-'))
  temporaryDirectories.push(root)
  return {
    materialRoot: join(root, 'material'),
    audioRoot: join(root, 'audio-fixed'),
    audioDynamicRoot: join(root, 'audio-dynamic'),
    previewRoot: join(root, 'preview')
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('saveTemporaryStoryCardAudio', () => {
  it('writes a full WebM recording and returns a safe temporary audio ref', () => {
    const roots = makeRoots()
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])

    const saved = saveTemporaryStoryCardAudio(bytes, 'audio/webm;codecs=opus', roots)

    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.ref).toMatch(/^felt-resource:\/\/audio\/dynamic\/story-card\/temp\/[a-f0-9]+\.webm$/)
    expect(saved.ref).not.toContain(roots.audioDynamicRoot)

    const resolved = resolveFeltResourcePath(saved.ref, roots)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(existsSync(resolved.absolutePath)).toBe(true)
    expect(readFileSync(resolved.absolutePath)).toEqual(Buffer.from(bytes))
  })

  it('rejects empty audio and unsupported MIME types', () => {
    const roots = makeRoots()

    expect(saveTemporaryStoryCardAudio(new Uint8Array(), 'audio/webm', roots).ok).toBe(false)
    expect(saveTemporaryStoryCardAudio(new Uint8Array([1]), 'audio/mpeg', roots).ok).toBe(false)
  })

  it('deletes only temporary story-card audio refs', () => {
    const roots = makeRoots()
    const saved = saveTemporaryStoryCardAudio(new Uint8Array([1]), 'audio/webm', roots)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    expect(deleteTemporaryStoryCardAudio(saved.ref, roots)).toEqual({ ok: true })
    expect(resolveFeltResourcePath(saved.ref, roots, { requireExists: false })).toMatchObject({ ok: true, exists: false })
    expect(deleteTemporaryStoryCardAudio('felt-resource://audio/dynamic/tts.mp3', roots).ok).toBe(false)
    expect(deleteTemporaryStoryCardAudio('felt-resource://audio/keep.mp3', roots).ok).toBe(false)
  })

  it('reads only a bounded temporary recording for the protected ASR bridge', () => {
    const roots = makeRoots()
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    const saved = saveTemporaryStoryCardAudio(bytes, 'audio/webm', roots)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    expect(readTemporaryStoryCardAudio(saved.ref, roots)).toEqual({
      ok: true,
      audioBase64: Buffer.from(bytes).toString('base64'),
      mimeType: 'audio/webm'
    })
    expect(readTemporaryStoryCardAudio('felt-resource://audio/dynamic/tts/example.mp3', roots).ok).toBe(false)
  })

  it('moves full recordings to the protected confirmed namespace before formal binding', () => {
    const roots = makeRoots()
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    const saved = saveTemporaryStoryCardAudio(bytes, 'audio/webm', roots)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const promoted = promoteTemporaryStoryCardAudio(saved.ref, roots)
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) return
    expect(promoted.ref).toMatch(/^felt-resource:\/\/audio\/dynamic\/story-card\/confirmed\/[a-f0-9]+\.webm$/)
    expect(deleteTemporaryStoryCardAudio(promoted.ref, roots).ok).toBe(false)
    expect(promoteTemporaryStoryCardAudio(promoted.ref, roots).ok).toBe(false)
    expect(resolveFeltResourcePath(saved.ref, roots, { requireExists: false })).toMatchObject({ ok: true, exists: false })

    const confirmed = resolveFeltResourcePath(promoted.ref, roots)
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(readFileSync(confirmed.absolutePath)).toEqual(Buffer.from(bytes))
  })
})

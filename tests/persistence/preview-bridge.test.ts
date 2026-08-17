import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_PROJECT_PREVIEW_PNG_BYTES, parseTrustedPngBytes } from '../../src/main/preview/png'
import { deletePreviewPng, savePreviewPng } from '../../src/main/preview/write'
import { resolveFeltResourcePath } from '../../src/shared/resource/resolve-path'
import { MINIMAL_PNG_BYTES } from './fixtures'

const tempDirs: string[] = []

function makeRoots() {
  const dir = mkdtempSync(join(tmpdir(), 'felt-preview-'))
  tempDirs.push(dir)
  const materialRoot = join(dir, 'material')
  const audioRoot = join(dir, 'audio')
  const audioDynamicRoot = join(dir, 'audio-dynamic')
  const previewRoot = join(dir, 'previews')
  const personalRoot = join(dir, 'personal-assets')
  mkdirSync(materialRoot, { recursive: true })
  mkdirSync(audioRoot, { recursive: true })
  mkdirSync(join(audioDynamicRoot, 'dynamic'), { recursive: true })
  mkdirSync(previewRoot, { recursive: true })
  mkdirSync(personalRoot, { recursive: true })
  writeFileSync(join(materialRoot, 'keep.png'), MINIMAL_PNG_BYTES)
  writeFileSync(join(audioRoot, 'keep.mp3'), Buffer.from('mp3'))
  return {
    dir,
    roots: { materialRoot, audioRoot, audioDynamicRoot, previewRoot, personalRoot }
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('project preview PNG gate', () => {
  it('accepts a valid PNG under the size cap', () => {
    const result = parseTrustedPngBytes(MINIMAL_PNG_BYTES)
    expect(result.ok).toBe(true)
  })

  it('rejects non-PNG bytes', () => {
    expect(parseTrustedPngBytes(Buffer.from('not-a-png')).ok).toBe(false)
  })

  it('rejects oversized PNG payloads', () => {
    const huge = Buffer.alloc(MAX_PROJECT_PREVIEW_PNG_BYTES + 1, 0)
    MINIMAL_PNG_BYTES.forEach((byte, index) => {
      huge[index] = byte
    })
    const result = parseTrustedPngBytes(huge)
    expect(result).toEqual({ ok: false, reason: 'too_large' })
  })
})

describe('project preview write/delete', () => {
  it('writes a unique felt-resource://preview ref without exposing OS paths', () => {
    const { roots } = makeRoots()
    const saved = savePreviewPng(MINIMAL_PNG_BYTES, roots)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    expect(saved.ref).toMatch(/^felt-resource:\/\/preview\/[0-9a-f]{32}\.png$/i)
    expect(JSON.stringify(saved)).not.toMatch(/previews|\\|C:/i)

    const resolved = resolveFeltResourcePath(saved.ref, roots)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.exists).toBe(true)
    expect(readFileSync(resolved.absolutePath).equals(Buffer.from(MINIMAL_PNG_BYTES))).toBe(true)
  })

  it('rejects non-PNG and oversized writes', () => {
    const { roots } = makeRoots()
    expect(savePreviewPng(Buffer.from('nope'), roots).ok).toBe(false)

    const huge = Buffer.alloc(MAX_PROJECT_PREVIEW_PNG_BYTES + 8, 0x89)
    expect(savePreviewPng(huge, roots).ok).toBe(false)
  })

  it('deletes only preview refs and rejects material/audio/traversal', () => {
    const { roots } = makeRoots()
    const saved = savePreviewPng(MINIMAL_PNG_BYTES, roots)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    expect(deletePreviewPng(saved.ref, roots)).toEqual({ ok: true })
    const after = resolveFeltResourcePath(saved.ref, roots, { requireExists: false })
    expect(after.ok && after.exists).toBe(false)

    expect(deletePreviewPng('felt-resource://material/keep.png', roots).ok).toBe(false)
    expect(deletePreviewPng('felt-resource://audio/keep.mp3', roots).ok).toBe(false)
    expect(deletePreviewPng('felt-resource://preview/../material/keep.png', roots).ok).toBe(false)
    expect(deletePreviewPng(join(roots.previewRoot, 'x.png'), roots).ok).toBe(false)
    expect(existsSync(join(roots.materialRoot, 'keep.png'))).toBe(true)
  })
})

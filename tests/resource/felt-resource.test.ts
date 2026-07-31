import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { isSafeResourceRef } from '../../src/shared/contracts/validation'
import {
  FELT_RESOURCE_REF_POLICY,
  buildFeltResourceRef,
  parseFeltResourceRef
} from '../../src/shared/resource'
import { resolveFeltResourcePath } from '../../src/shared/resource/resolve-path'

const tempDirs: string[] = []

function makeRoots(): { roots: { materialRoot: string; audioRoot: string; previewRoot: string }; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'felt-resource-'))
  tempDirs.push(dir)
  const materialRoot = join(dir, 'material')
  const audioRoot = join(dir, 'audio')
  const previewRoot = join(dir, 'preview')
  mkdirSync(materialRoot, { recursive: true })
  mkdirSync(audioRoot, { recursive: true })
  mkdirSync(previewRoot, { recursive: true })
  writeFileSync(join(materialRoot, 'mock-sticker.png'), 'png-mock')
  writeFileSync(join(audioRoot, 'mock-name-zh.wav'), 'wav-mock')
  writeFileSync(join(previewRoot, 'project-demo.png'), 'preview-mock')
  return { dir, roots: { materialRoot, audioRoot, previewRoot } }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('felt-resource parse', () => {
  it('parses material/audio/preview refs', () => {
    expect(parseFeltResourceRef('felt-resource://material/mock-sticker.png')).toEqual({
      ref: 'felt-resource://material/mock-sticker.png',
      kind: 'material',
      relativePath: 'mock-sticker.png'
    })
    expect(buildFeltResourceRef('audio', 'fixed/a.wav')).toBe('felt-resource://audio/fixed/a.wav')
  })

  it('rejects illegal protocols and traversal', () => {
    expect(parseFeltResourceRef('https://example.com/a.png')).toBeUndefined()
    expect(parseFeltResourceRef('file:///C:/secret.png')).toBeUndefined()
    expect(parseFeltResourceRef('felt-resource://material/../secret.png')).toBeUndefined()
    expect(parseFeltResourceRef('felt-resource://material/%2e%2e/secret.png')).toBeUndefined()
    expect(parseFeltResourceRef('felt-resource://other/a.png')).toBeUndefined()
    expect(parseFeltResourceRef('felt-resource://material/a.png?token=1')).toBeUndefined()
  })

  it('is accepted by contract ResourceRef policy', () => {
    expect(isSafeResourceRef('felt-resource://material/mock-sticker.png', FELT_RESOURCE_REF_POLICY)).toBe(true)
    expect(isSafeResourceRef('mock://assets/a.png', FELT_RESOURCE_REF_POLICY)).toBe(false)
    expect(isSafeResourceRef('felt-resource://material/../x.png', FELT_RESOURCE_REF_POLICY)).toBe(false)
  })
})

describe('felt-resource path resolve', () => {
  it('resolves existing local mocks for three kinds', () => {
    const { roots } = makeRoots()
    const material = resolveFeltResourcePath('felt-resource://material/mock-sticker.png', roots)
    const audio = resolveFeltResourcePath('felt-resource://audio/mock-name-zh.wav', roots)
    const preview = resolveFeltResourcePath('felt-resource://preview/project-demo.png', roots)
    expect(material.ok).toBe(true)
    expect(audio.ok).toBe(true)
    expect(preview.ok).toBe(true)
    if (material.ok) expect(material.absolutePath.endsWith('mock-sticker.png')).toBe(true)
  })

  it('returns ASSET_NOT_FOUND when missing', () => {
    const { roots } = makeRoots()
    const missing = resolveFeltResourcePath('felt-resource://material/missing.png', roots)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('ASSET_NOT_FOUND')
  })

  it('blocks path escape outside kind root', () => {
    const { roots } = makeRoots()
    const escaped = resolveFeltResourcePath('felt-resource://material/..%2F..%2Fsecret.txt', roots)
    expect(escaped.ok).toBe(false)
    if (!escaped.ok) expect(escaped.error.code).toBe('INVALID_ARGUMENT')
  })
})

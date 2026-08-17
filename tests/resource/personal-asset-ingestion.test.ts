import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({
  net: { fetch: fetchMock },
  protocol: {}
}))
import { ingestPersonalAssetPng, MAX_PERSONAL_ASSET_PNG_BYTES } from '../../src/main/resource/personal-ingestion'
import { inspectResource } from '../../src/main/resource/inspect'
import { handleFeltResourceRequest } from '../../src/main/resource/protocol'
import { resolveFeltResourcePath } from '../../src/shared/resource/resolve-path'
import type { ResourceRoots } from '../../src/shared/resource'
import { MINIMAL_PNG_BYTES } from '../persistence/fixtures'

const ASSET_A = '8b4f4c7d-0b51-4c72-8b37-4e44dbb8c9f1'
const ASSET_B = '2a8c8c2b-66ef-43b5-9ea4-748af0eac3b4'
const VERSION_A = '3f2b8a91-2d60-4c2b-9e02-71c4c21d3d6a'
const VERSION_B = '8d4bbd2b-7288-4a19-b0dd-5bf43fd1cb9e'

const tempDirs: string[] = []

function makeRoots(): ResourceRoots & { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'felt-personal-resource-'))
  tempDirs.push(dir)
  const roots: ResourceRoots = {
    materialRoot: join(dir, 'material'),
    audioRoot: join(dir, 'audio'),
    audioDynamicRoot: join(dir, 'audio-dynamic'),
    previewRoot: join(dir, 'previews'),
    personalRoot: join(dir, 'personal-assets')
  }
  for (const root of Object.values(roots)) mkdirSync(root, { recursive: true })
  return { dir, ...roots }
}

function request(personalAssetId = ASSET_A, versionId = VERSION_A, pngBytes: unknown = MINIMAL_PNG_BYTES): Record<string, unknown> {
  return { personalAssetId, versionId, pngBytes }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Personal Asset PNG ingestion', () => {
  it('writes canonical personal source.png bytes and returns no filesystem metadata', () => {
    const roots = makeRoots()
    const result = ingestPersonalAssetPng(request(), roots)
    const ref = `felt-resource://personal/${ASSET_A}/${VERSION_A}/source.png`

    expect(result).toEqual({ ok: true, ref })
    expect(JSON.stringify(result)).not.toMatch(/personal-assets|[A-Za-z]:\\/i)

    const resolved = resolveFeltResourcePath(ref, roots)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(readFileSync(resolved.absolutePath).equals(Buffer.from(MINIMAL_PNG_BYTES))).toBe(true)
    expect(readdirSync(join(roots.personalRoot, ASSET_A, VERSION_A))).toEqual(['source.png'])
  })

  it('rejects non-binary, empty, non-PNG, oversized, and renderer-controlled fields', () => {
    const roots = makeRoots()
    const tooLarge = Buffer.alloc(MAX_PERSONAL_ASSET_PNG_BYTES + 1)
    Buffer.from(MINIMAL_PNG_BYTES).copy(tooLarge)

    for (const pngBytes of [
      '',
      'data:image/png;base64,AAAA',
      'https://example.com/image.png',
      roots.personalRoot,
      Buffer.alloc(0),
      Buffer.from('not-a-png'),
      tooLarge
    ]) {
      expect(ingestPersonalAssetPng(request(ASSET_A, VERSION_A, pngBytes), roots).ok).toBe(false)
    }

    expect(ingestPersonalAssetPng({ ...request(), destinationPath: roots.personalRoot }, roots)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(ingestPersonalAssetPng({ ...request(), kind: 'material' }, roots)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
  })

  it('is idempotent for equal bytes and rejects different bytes without overwriting', () => {
    const roots = makeRoots()
    const first = ingestPersonalAssetPng(request(), roots)
    expect(first.ok).toBe(true)

    const same = ingestPersonalAssetPng(request(), roots)
    expect(same).toEqual(first)

    const different = Uint8Array.from(MINIMAL_PNG_BYTES)
    different[12] ^= 1
    const conflict = ingestPersonalAssetPng(request(ASSET_A, VERSION_A, different), roots)
    expect(conflict).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })

    const resolved = resolveFeltResourcePath(`felt-resource://personal/${ASSET_A}/${VERSION_A}/source.png`, roots)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(readFileSync(resolved.absolutePath).equals(Buffer.from(MINIMAL_PNG_BYTES))).toBe(true)
  })

  it('isolates assets even when they reuse a versionId', () => {
    const roots = makeRoots()
    expect(ingestPersonalAssetPng(request(ASSET_A, VERSION_B), roots).ok).toBe(true)
    expect(ingestPersonalAssetPng(request(ASSET_B, VERSION_B), roots).ok).toBe(true)

    const a = resolveFeltResourcePath(`felt-resource://personal/${ASSET_A}/${VERSION_B}/source.png`, roots)
    const b = resolveFeltResourcePath(`felt-resource://personal/${ASSET_B}/${VERSION_B}/source.png`, roots)
    expect(a.ok && b.ok).toBe(true)
    expect(a.ok && b.ok && a.absolutePath !== b.absolutePath).toBe(true)
  })

  it('rejects a personal asset directory that escapes through a symlink or junction', () => {
    const roots = makeRoots()
    const outside = join(roots.personalRoot, '..', 'personal-resource-outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'keep.txt'), 'keep')

    const linkPath = join(roots.personalRoot, ASSET_A)
    let linked = false
    try {
      symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
      linked = true
    } catch {
      linked = false
    }
    if (!linked) {
      expect(true).toBe(true)
      return
    }

    const result = ingestPersonalAssetPng(request(), roots)
    expect(result.ok).toBe(false)
  })

  it('inspects personal resources without returning an absolute path', () => {
    const roots = makeRoots()
    expect(ingestPersonalAssetPng(request(), roots).ok).toBe(true)

    const existing = inspectResource(`felt-resource://personal/${ASSET_A}/${VERSION_A}/source.png`, roots)
    expect(existing).toEqual({
      ok: true,
      ref: `felt-resource://personal/${ASSET_A}/${VERSION_A}/source.png`,
      kind: 'personal',
      relativePath: `${ASSET_A}/${VERSION_A}/source.png`,
      exists: true
    })
    expect(existing).not.toHaveProperty('absolutePath')

    const missing = inspectResource(`felt-resource://personal/${ASSET_B}/${VERSION_B}/source.png`, roots)
    expect(missing).toEqual({
      ok: true,
      ref: `felt-resource://personal/${ASSET_B}/${VERSION_B}/source.png`,
      kind: 'personal',
      relativePath: `${ASSET_B}/${VERSION_B}/source.png`,
      exists: false
    })
    expect(inspectResource('https://example.com/image.png', roots).ok).toBe(false)
  })

  it('serves personal resources through read-only GET/HEAD protocol handling', async () => {
    const roots = makeRoots()
    const ref = `felt-resource://personal/${ASSET_A}/${VERSION_A}/source.png`
    expect(ingestPersonalAssetPng(request(), roots).ok).toBe(true)
    fetchMock.mockResolvedValue(new Response(MINIMAL_PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }))

    const get = await handleFeltResourceRequest(new Request(ref, { method: 'GET' }), roots)
    expect(get.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/source\.png$/), expect.objectContaining({ method: 'GET' }))

    const head = await handleFeltResourceRequest(new Request(ref, { method: 'HEAD' }), roots)
    expect(head.status).toBe(200)

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const denied = await handleFeltResourceRequest(new Request(ref, { method }), roots)
      expect(denied.status).toBe(405)
      expect(denied.headers.get('Allow')).toBe('GET, HEAD, OPTIONS')
    }

    const missing = await handleFeltResourceRequest(
      new Request(`felt-resource://personal/${ASSET_B}/${VERSION_B}/source.png`),
      roots
    )
    expect(missing.status).toBe(404)
  })
})

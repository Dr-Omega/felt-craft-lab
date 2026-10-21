import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { decodePngDataUrl } from '../../src/renderer/src/services/png-data-url'

afterEach(() => vi.unstubAllGlobals())
it('decodes exact PNG bytes locally without fetch under production CSP', () => {
  const png = readFileSync('assets/generated/material/snapshot_ywn_psd_20261017/provided/fuwa/composite.png')
  const fetch = vi.fn(() => { throw new Error('connect-src blocks data URLs') })
  vi.stubGlobal('fetch', fetch)
  expect(decodePngDataUrl('data:image/png;base64,' + png.toString('base64'))).toEqual(new Uint8Array(png))
  expect(fetch).not.toHaveBeenCalled()
})
it('rejects invalid, empty, non-PNG and remote sources before ingestion', () => {
  for (const src of ['data:image/png;base64,', 'data:image/png;base64,%%%','data:image/png;base64,SGVsbG8=', 'data:image/jpeg;base64,/9j/', 'https://example.com/image.png']) {
    expect(() => decodePngDataUrl(src)).toThrow()
  }
})
it('keeps the PSD apply path off fetch(data:) too', () => {
  const editor = readFileSync('src/renderer/src/pages/EditorPage.vue', 'utf8')
  expect(editor).not.toContain('fetch(png)')
  expect(editor).toContain('decodePngDataUrl(png)')
})

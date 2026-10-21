import 'fake-indexeddb/auto'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as artwork from '../../src/renderer/src/projection/provided-psd-artwork'
import { persistCanvasInput } from '../../src/renderer/src/fabrication/canvas-intake'
import { checkedPsdEdit, originalPsdEdit, providedPsdPack, psdLayerColors } from '../../src/renderer/src/projection/provided-psd-artwork'
import { createFeltCraftDatabase, PersonalAssetVersionStore } from '../../src/renderer/src/persistence'
import { validatePersonalAssetVersionRecord } from '../../src/shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '../../src/shared/resource'
import { isProvidedPsdDemoEnabled, ProvidedDemoController } from '../../src/renderer/src/services/provided-demo.controller'

vi.mock('../../src/renderer/src/fabrication/canvas-intake', () => ({ persistCanvasInput: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(persistCanvasInput).mockReset() })
describe('provided PSD version bindings', () => {
  it('uses exactly the authored visible layers and original color for each', () => {
    for (const [key, count] of [['fuwa',8],['hongbao',3],['denglong',2],['jiaozi',2]] as const) {
      const edit = originalPsdEdit(providedPsdPack(key)), colors = psdLayerColors(edit)
      expect(colors.layers).toHaveLength(count)
      expect(colors.layers.map(l => l.hex)).toEqual(edit.colors)
      expect(new Set(colors.layers.map(l => l.layerId)).size).toBe(count)
      if (key === 'hongbao') expect(colors.layers[0].pieceIds).toEqual(['psd-001'])
      const changed = structuredClone(edit); changed.colors[0] = '#3575CF'
      expect(checkedPsdEdit(changed)).toEqual(changed)
      expect(originalPsdEdit(providedPsdPack(key))).toEqual(edit)
    }
  })
  it('rejects changed source identity, missing/reordered membership, unknown fields and invalid colors', () => {
    const edit = originalPsdEdit(providedPsdPack('hongbao'))
    for (const wrong of [{ ...edit, sourceSha256: '0'.repeat(64) }, { ...edit, colors: edit.colors.slice(1) },
      { ...edit, colors: ['white', ...edit.colors.slice(1)] }, { ...edit, layers: [] }]) expect(() => checkedPsdEdit(wrong)).toThrow()
  })
  it('persists source and colors inside the immutable version, not only in localStorage', async () => {
    const db = createFeltCraftDatabase('psd-version-' + crypto.randomUUID())
    try {
      const versionId = crypto.randomUUID(), personalAssetId = crypto.randomUUID()
      const record = { versionId, personalAssetId, versionNumber: 1,
        sourceImageRef: `felt-resource://personal/${personalAssetId}/${versionId}/source.png`, parentVersionId: null,
        createdAt: '2026-10-17T00:00:00.000Z', providedPsd: originalPsdEdit(providedPsdPack('fuwa')) }
      expect(validatePersonalAssetVersionRecord(record, FELT_RESOURCE_REF_POLICY).ok).toBe(true)
      const store = new PersonalAssetVersionStore(db)
      await store.save(record)
      expect((await store.get(versionId))!.providedPsd).toEqual(record.providedPsd)
      await expect(store.save(structuredClone(record))).resolves.toEqual(record)
      const changed = structuredClone(record); changed.providedPsd.colors[0] = '#FFFFFF'
      await expect(store.save(changed)).rejects.toThrow('immutable')
    } finally { await db.delete() }
  })
})
describe('explicit provided-image demo', () => {
  it('keeps the loading state for five seconds, blocks duplicate clicks and delays redraw too', async () => {
    vi.useFakeTimers()
    const image = vi.spyOn(artwork, 'psdImageDataUrl').mockResolvedValue('data:image/png;base64,demo')
    const controller = new ProvidedDemoController()
    await controller.acceptUtterance('福娃')
    const generating = controller.confirmPlan()
    expect(controller.busy).toBe(true)
    expect(controller.busyHint).toBe('正在生成图片…')
    await controller.confirmPlan()
    expect(image).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(controller.candidateRef).toBeNull()
    expect(controller.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(1); await generating
    expect(controller.phase).toBe('generated')
    expect(controller.busy).toBe(false)
    const redraw = controller.redrawCandidate()
    expect(controller.candidateRef).toBeNull()
    await vi.advanceTimersByTimeAsync(5_000); await redraw
    expect(controller.candidateRef).toBe('data:image/png;base64,demo')
  })
  it('does not show a delayed result after leaving or resetting', async () => {
    vi.useFakeTimers()
    vi.spyOn(artwork, 'psdImageDataUrl').mockResolvedValue('data:image/png;base64,demo')
    const controller = new ProvidedDemoController()
    await controller.acceptUtterance('福娃')
    const generating = controller.confirmPlan()
    controller.dispose()
    await vi.advanceTimersByTimeAsync(5_000); await generating
    expect(controller.phase).toBe('idle')
    expect(controller.candidateRef).toBeNull()
    expect(controller.busy).toBe(false)
  })
  it('adopts the exact preview PNG with its eight PSD layers without fetching a data URL (production CSP)', async () => {
    vi.useFakeTimers()
    const pack = providedPsdPack('fuwa')
    const png = readFileSync('assets/generated/' + pack.imageUrl.replace('felt-resource://', ''))
    vi.spyOn(artwork, 'psdImageDataUrl').mockResolvedValue('data:image/png;base64,' + png.toString('base64'))
    const fetchUnderCsp = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchUnderCsp)
    const personalAssetId = crypto.randomUUID(), versionId = crypto.randomUUID(), createdAt = new Date().toISOString()
    const providedPsd = originalPsdEdit(pack)
    vi.mocked(persistCanvasInput).mockResolvedValue({
      asset: { personalAssetId, currentVersionId: versionId, userId: 'user_demo_001', name: '福娃',
        role: 'core_pattern', sourceType: 'ai_generated', createdAt, updatedAt: createdAt },
      version: { personalAssetId, versionId, versionNumber: 1, parentVersionId: null, createdAt,
        sourceImageRef: `felt-resource://personal/${personalAssetId}/${versionId}/source.png`, providedPsd }
    })
    const controller = new ProvidedDemoController()
    await controller.acceptUtterance('一头牛')
    const generating = controller.confirmPlan()
    await vi.advanceTimersByTimeAsync(5_000); await generating; await controller.acceptCandidate()
    expect(controller.error).toBeNull()
    expect(controller.phase).toBe('accepted')
    expect(fetchUnderCsp).not.toHaveBeenCalled()
    expect(persistCanvasInput).toHaveBeenCalledWith(new Uint8Array(png), '福娃', 'user_demo_001', 'ai_generated', providedPsd, 'core_pattern')
    expect(controller.accepted?.versionId).toBe(versionId)
  })
  it('is off by default; only the explicit 1 flag enables it', () => {
    for (const value of [undefined, '', '0', 'true', true]) expect(isProvidedPsdDemoEnabled(value)).toBe(false)
    expect(isProvidedPsdDemoEnabled('1')).toBe(true)
  })
  it('accepts different descriptions locally without calling the intent or image-generation API', async () => {
    const controller = new ProvidedDemoController()
    for (const text of ['我想生成一个福娃', '一只鸡', '一头牛']) {
      controller.reset(); controller.text = text; await controller.submitCurrentText()
      expect(controller.phase).toBe('ready_to_confirm')
      expect(controller.hasPlan).toBe(true)
      expect(controller.summary).toBe(text)
    }
  })
})

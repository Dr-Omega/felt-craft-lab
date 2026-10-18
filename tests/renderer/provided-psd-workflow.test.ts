import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { checkedPsdEdit, originalPsdEdit, providedPsdPack, psdLayerColors } from '../../src/renderer/src/projection/provided-psd-artwork'
import { createFeltCraftDatabase, PersonalAssetVersionStore } from '../../src/renderer/src/persistence'
import { validatePersonalAssetVersionRecord } from '../../src/shared/contracts/validation'
import { FELT_RESOURCE_REF_POLICY } from '../../src/shared/resource'
import { isProvidedPsdDemoEnabled, ProvidedDemoController } from '../../src/renderer/src/services/provided-demo.controller'

vi.mock('../../src/renderer/src/fabrication/canvas-intake', () => ({ persistCanvasInput: vi.fn() }))
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

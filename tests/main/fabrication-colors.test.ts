import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FabricationJobs } from '../../src/main/fabrication/jobs'

describe('durable layer editing and restoration (fixture results, no algorithm execution)', () => {
  it('restores completed jobs, saves colors, prevents stale or altered identity and leaves result bytes untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'felt-colors-'))
    const id = '00000000-0000-4000-8000-000000000001'
    const dir = join(root, id)
    const config = { root, jobsRoot: root, python: '', backgroundPython: '', modelCache: '' }
    const view = { schemaVersion: 'desktop-fabrication-view/1', geometryStatus: 'PASS', productionExportEligible: false,
      resultSha256: 'a'.repeat(64), steps: [{ step: 1, pieceIds: ['a','b'], colorSlotId: 'red', rgb: [255,0,0] }] }
    try {
      await mkdir(dir)
      const original = JSON.stringify(view)
      await writeFile(join(dir, 'view.json'), original)
      await writeFile(join(dir, 'desktop-job.json'), JSON.stringify({ id, status: 'complete', result: view }))
      const jobs = new FabricationJobs(config)
      await jobs.resume(id)
      const initial = await jobs.colors(id)
      const edit = structuredClone(initial); edit.layers[0].hex = '#123456'
      expect((await jobs.saveColors(id, edit)).revision).toBe(1)
      await expect(jobs.saveColors(id, edit)).rejects.toThrow('版本已更新')
      const fresh = new FabricationJobs(config); await fresh.resume(id)
      expect((await fresh.colors(id)).layers[0].hex).toBe('#123456')
      expect(await readFile(join(dir, 'view.json'), 'utf8')).toBe(original)
      const bad = await fresh.colors(id); bad.layers[0].pieceIds = ['other']
      await expect(fresh.saveColors(id, bad)).rejects.toThrow('裁片绑定')
      await expect(fresh.resume('../escape')).rejects.toThrow('无效')
      await writeFile(join(dir, 'layer-colors.json'), JSON.stringify(bad))
      await expect(fresh.colors(id)).rejects.toThrow('裁片绑定')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

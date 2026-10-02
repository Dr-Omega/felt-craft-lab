import { describe, it, expect } from 'vitest'
import { validateStart, FabricationJobs } from '../../src/main/fabrication/jobs'

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
describe('desktop fabrication boundary', () => {
  it('accepts only supported bytes and explicit mode', () => {
    expect(() => validateStart(png, 'embedded-alpha')).not.toThrow()
    expect(() => validateStart(new Uint8Array([255, 216, 255]), 'birefnet-general')).not.toThrow()
    for (const value of ['C:/secret.png', {}, new Uint8Array(), new Uint8Array([4, 3, 2])]) {
      expect(() => validateStart(value, 'embedded-alpha')).toThrow()
    }
    expect(() => validateStart(png, '--whole-image-foreground')).toThrow()
    expect(() => validateStart(new Uint8Array(10 * 1024 * 1024 + 1), 'birefnet-general')).toThrow()
  })
  it('missing configured runtime fails rather than using a demo or another model', async () => {
    const jobs = new FabricationJobs({ root: '', jobsRoot: '', python: '', backgroundPython: '', modelCache: '' })
    await expect(jobs.start(png, 'birefnet-general')).rejects.toThrow('算法环境未配置')
    expect(() => jobs.status('../../other')).toThrow('不存在')
    await expect(jobs.asset('../../other', 'input')).rejects.toThrow('不存在')
  })
})

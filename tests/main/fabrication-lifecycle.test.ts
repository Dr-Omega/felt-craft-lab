import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { FabricationJobs } from '../../src/main/fabrication/jobs'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
let root: string
const children: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'felt-fabrication-ipc-test-'))
  children.length = 0
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
      kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true }) })
    children.push(child)
    return child as unknown as ReturnType<typeof spawn>
  })
})
afterEach(async () => { vi.useRealTimers(); vi.clearAllMocks(); await rm(root, { recursive: true, force: true }) })
function manager(timeoutMs = 60_000): FabricationJobs {
  return new FabricationJobs({ root, jobsRoot: root, python: process.execPath,
    backgroundPython: process.execPath, modelCache: root, timeoutMs })
}
function finish(index: number, code = 0): void {
  children[index].stdout.end(); children[index].stderr.end(); children[index].emit('close', code)
}
const view = { schemaVersion: 'desktop-fabrication-view/1', geometryStatus: 'PASS',
  productionExportEligible: false, assets: { valid: 'piece.png', escape: '../outside.png', text: 'secret.txt' } }

describe('fabrication lifecycle (processes stubbed, no geometry PASS fabricated in production)', () => {
  it('rejects concurrent work; retains stage failure and permits a later retry', async () => {
    const jobs = manager()
    const first = await jobs.start(png, 'embedded-alpha')
    await expect(jobs.start(png, 'embedded-alpha')).rejects.toThrow('已有图片')
    finish(0, 9)
    await vi.waitFor(() => expect(jobs.status(first.id).status).toBe('failed'))
    expect(jobs.status(first.id).message).toContain('background')
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(root, first.id, 'desktop-job.json'), 'utf8')).status).toBe('failed'))
    const next = await jobs.start(png, 'embedded-alpha')
    expect(next.id).not.toBe(first.id)
    finish(1, 9)
    await vi.waitFor(() => expect(jobs.status(next.id).status).toBe('failed'))
  })
  it('requires the result contract and only serves contained manifest image files', async () => {
    const jobs = manager()
    const job = await jobs.start(png, 'embedded-alpha')
    const folder = join(root, job.id)
    await writeFile(join(folder, 'view.json'), JSON.stringify(view))
    await writeFile(join(folder, 'piece.png'), png)
    await writeFile(join(root, 'outside.png'), png)
    await writeFile(join(folder, 'secret.txt'), 'private')
    finish(0)
    await vi.waitFor(() => expect(children.length).toBe(2))
    finish(1)
    await vi.waitFor(() => expect(jobs.status(job.id).status).toBe('complete'))
    expect((await jobs.asset(job.id, 'valid')).bytes).toEqual(Buffer.from(png))
    await expect(jobs.asset(job.id, 'escape')).rejects.toThrow('非法')
    await expect(jobs.asset(job.id, 'text')).rejects.toThrow('非法')
    await expect(jobs.asset(job.id, '__proto__')).rejects.toThrow('尚未就绪')
    await expect(jobs.asset(job.id, 'C:/secret')).rejects.toThrow('尚未就绪')
  })
  it('does not call an invalid persisted result complete', async () => {
    const jobs = manager()
    const job = await jobs.start(png, 'embedded-alpha')
    await writeFile(join(root, job.id, 'view.json'), JSON.stringify({ ...view, geometryStatus: 'FAIL' }))
    finish(0)
    await vi.waitFor(() => expect(children.length).toBe(2))
    finish(1)
    await vi.waitFor(() => expect(jobs.status(job.id).status).toBe('failed'))
    expect(jobs.status(job.id).result).toBeUndefined()
  })
  it('times out rather than displaying a partial result', async () => {
    const jobs = manager(30)
    const job = await jobs.start(png, 'embedded-alpha')
    await vi.waitFor(() => expect(jobs.status(job.id).status).toBe('timeout'))
    expect(children[0].kill).toHaveBeenCalled()
    expect(jobs.status(job.id).result).toBeUndefined()
  })
})

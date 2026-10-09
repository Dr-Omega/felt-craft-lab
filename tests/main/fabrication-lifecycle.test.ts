import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { FabricationJobs } from '../../src/main/fabrication/jobs'
import { validScene } from '../shared/contracts.fixtures'

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
async function finish(index: number, code = 0): Promise<void> {
  await vi.waitFor(()=>expect(children.length).toBeGreaterThan(index))
  children[index].stdout.end(); children[index].stderr.end(); children[index].emit('close', code)
}
const view = { schemaVersion: 'desktop-fabrication-view/1', geometryStatus: 'PASS',
  productionExportEligible: false, assets: { valid: 'piece.png', escape: '../outside.png', text: 'secret.txt' } }

describe('fabrication lifecycle (processes stubbed, no geometry PASS fabricated in production)', () => {
  it('never shares an unbound task admission key between authenticated accounts', async () => {
    const jobs=manager()
    const a=await jobs.start(png,'embedded-alpha',null,'account-a')
    const b=await jobs.start(png,'embedded-alpha',null,'account-b')
    expect(b.id).not.toBe(a.id)
    expect((await jobs.start(png,'embedded-alpha',null,'account-a')).id).toBe(a.id)
    expect(jobs.status(a.id).ownerUserId).toBe('account-a')
    await expect(jobs.start(png,'embedded-alpha',{scene:structuredClone(validScene)},'other')).rejects.toThrow('当前账号')
    await jobs.shutdown()
  })
  it('queues distinct images and drains after a stage failure, without simultaneous workers', async () => {
    const jobs=manager()
    const [a,b]=await Promise.all([jobs.start(png,'embedded-alpha'), jobs.start(new Uint8Array([...png,1]),'embedded-alpha')])
    await vi.waitFor(()=>expect(children.length).toBe(1))
    expect(jobs.status(b.id).status).toBe('queued')
    expect((await jobs.list()).length).toBe(2)
    await finish(0,9)
    await vi.waitFor(()=>expect(children.length).toBe(2))
    expect(jobs.status(a.id).status).toBe('failed')
    await finish(1,9)
    await vi.waitFor(()=>expect(jobs.status(b.id).status).toBe('failed'))
    await jobs.shutdown()
  })
  it('reuses a bound image after scene timestamp and transform changes, but not changed bytes or mode', async () => {
    const jobs=manager(), scene=structuredClone(validScene)
    const binding={scene,objectId:scene.objects[0].objectId}
    const a=await jobs.start(png,'embedded-alpha',binding)
    const moved=structuredClone(binding); moved.scene.updatedAt='2026-10-08T00:00:00.000Z'; moved.scene.objects[0].left+=10
    expect((await jobs.start(png,'embedded-alpha',moved)).id).toBe(a.id)
    expect((await jobs.start(new Uint8Array([...png,1]),'embedded-alpha',moved)).id).not.toBe(a.id)
    expect((await jobs.start(png,'birefnet-general',moved)).id).not.toBe(a.id)
    await jobs.shutdown()
  })
  it('recovers interrupted and queued requests after restart; only explicit retry executes', async () => {
    const jobs=manager()
    const a=await jobs.start(png,'embedded-alpha')
    const b=await jobs.start(new Uint8Array([...png,2]),'embedded-alpha')
    await vi.waitFor(()=>expect(children.length).toBe(1))
    await jobs.shutdown()
    const fresh=manager(), recovered=await fresh.list()
    expect(recovered.find(j=>j.id===a.id)?.status).toBe('failed')
    expect(recovered.find(j=>j.id===b.id)?.message).toContain('中断')
    expect(children.length).toBe(1)
    const again=await fresh.retry(b.id)
    expect(again.id).not.toBe(b.id)
    const repeated=await fresh.retry(b.id)
    expect(repeated.id).toBe(again.id)
    await fresh.shutdown()
  })
  it('rejects retry when the saved input has been changed', async () => {
    const jobs=manager(), a=await jobs.start(png,'embedded-alpha')
    await jobs.shutdown()
    await writeFile(join(root,a.id,'input.bin'),new Uint8Array([...png,3]))
    await expect(jobs.retry(a.id)).rejects.toThrow('输入已变化')
  })
  it('restores the latest attempt by time, not directory UUID order, without starting another worker', async () => {
    const jobs=manager(), first=await jobs.start(png,'embedded-alpha')
    await finish(0,9)
    await vi.waitFor(()=>expect(jobs.status(first.id).status).toBe('failed'))
    const second=await jobs.retry(first.id)
    await jobs.shutdown()
    const ordered=[first.id,second.id].sort()
    for(const [i,id] of ordered.entries()) {
      const path=join(root,id,'desktop-job.json')
      const record=JSON.parse(await readFile(path,'utf8'))
      record.startedAt=i===0?200:100
      await writeFile(path,JSON.stringify(record))
    }
    const fresh=manager(), count=children.length
    expect((await fresh.resume(first.id)).status).toBe('failed')
    expect((await fresh.start(png,'embedded-alpha')).id).toBe(ordered[0])
    expect(children.length).toBe(count)
  })
  it('restores completed queued-system results and their binding after restart', async () => {
    const jobs=manager(), job=await jobs.start(png,'embedded-alpha')
    await writeFile(join(root,job.id,'view.json'),JSON.stringify({...view,steps:[],resultSha256:'a'.repeat(64)}))
    await finish(0); await finish(1)
    await vi.waitFor(()=>expect(jobs.status(job.id).status).toBe('complete'))
    await jobs.shutdown()
    const fresh=manager(), count=children.length
    expect((await fresh.resume(job.id)).status).toBe('complete')
    expect((await fresh.start(png,'embedded-alpha')).id).toBe(job.id)
    expect(children.length).toBe(count)
  })
  it('reports missing packaged runtime files before spawning a worker', async () => {
    const jobs=new FabricationJobs({root,jobsRoot:root,python:process.execPath,
      backgroundPython:process.execPath,modelCache:root,requireRuntimeFiles:true})
    expect(jobs.availability().available).toBe(false)
    await expect(jobs.start(png,'embedded-alpha')).rejects.toThrow('FELT_FABRICATION_ROOT')
    expect(children.length).toBe(0)
  })
  it('invalidates task reuse after runtime implementation changes', async () => {
    const jobs=manager(), a=await jobs.start(png,'embedded-alpha')
    await jobs.shutdown()
    await writeFile(join(root,'package-lock.json'),'{}')
    const fresh=manager(), b=await fresh.start(png,'embedded-alpha')
    expect(b.id).not.toBe(a.id)
    await fresh.shutdown()
  })
  it('deduplicates work, retains failure, and retries only on explicit request', async () => {
    const jobs = manager()
    const first = await jobs.start(png, 'embedded-alpha')
    expect((await jobs.start(png, 'embedded-alpha')).id).toBe(first.id)
    await finish(0, 9)
    await vi.waitFor(() => expect(jobs.status(first.id).status).toBe('failed'))
    expect(jobs.status(first.id).message).toContain('background')
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(root, first.id, 'desktop-job.json'), 'utf8')).status).toBe('failed'))
    expect((await jobs.start(png, 'embedded-alpha')).id).toBe(first.id)
    const next = await jobs.retry(first.id)
    expect(next.id).not.toBe(first.id)
    await finish(1, 9)
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
    await finish(0)
    await vi.waitFor(() => expect(children.length).toBe(2))
    await finish(1)
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
    await finish(0)
    await vi.waitFor(() => expect(children.length).toBe(2))
    await finish(1)
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

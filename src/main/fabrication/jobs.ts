import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, writeFile, readFile, realpath, stat, rename, readdir } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { elementSourceIdentity } from '@shared/fabrication-task-identity'
import type { FabricationJob, FabricationView, ForegroundMode } from '@shared/fabrication-desktop'
import { initialColors, validateBinding, validateColors, type LayerColors } from '@shared/fabrication-colors'
import { readCuttingGeometry } from './cutting-geometry'

export interface RuntimeConfig {
  root: string
  jobsRoot: string
  python: string
  backgroundPython: string
  modelCache: string
  timeoutMs?: number
  requireRuntimeFiles?: boolean
}

export function validateStart(bytes: unknown, mode: unknown): asserts bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
    throw new Error('请选择不超过 10 MB 的 PNG 或 JPEG 图片。')
  }
  const png = Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!png && !jpeg) throw new Error('只支持 PNG 或 JPEG 图片。')
  if (mode !== 'birefnet-general' && mode !== 'embedded-alpha') throw new Error('无效前景模式。')
}

interface RequestRecord { mode: ForegroundMode; key: string; inputHash: string }
/** Persistent admission queue; only one worker at a time, no renderer-supplied paths. */
export class FabricationJobs {
  private jobs = new Map<string, FabricationJob>()
  private active = false
  private colorWrites = new Set<string>()
  private requests = new Map<string, RequestRecord>()
  private initialized?: Promise<void>
  private admission: Promise<unknown> = Promise.resolve()
  private implementation?: Promise<string>
  private stopping = false
  private stopWorker?: () => void
  private running?: Promise<void>
  constructor(private config: RuntimeConfig) {}

  async shutdown(): Promise<void> {
    this.stopping = true
    this.stopWorker?.()
    await this.running
  }

  availability(): { available: boolean; message: string } {
    const missing = !existsSync(this.config.python) || !existsSync(this.config.backgroundPython) || !existsSync(this.config.modelCache)
    const codeMissing = this.config.requireRuntimeFiles && !this.runtimeFilesPresent()
    return { available: !missing && !codeMissing, message: codeMissing
      ? '算法运行目录未安装：请配置 FELT_FABRICATION_ROOT（包含 backend、benchmarks、src/shared 与依赖）。'
      : missing ? '算法环境未配置：需要 Python 环境和已安装的 BiRefNet General 模型，不会自动下载或换模型。' : '算法环境路径已配置；实际运行仍会验证依赖及产物。' }
  }

  private runtimeFilesPresent(): boolean {
    return ['backend/fabrication/worker.py', 'benchmarks/fabrication-layer-decomposition/algorithm-v1/algorithm_runtime.py',
      'benchmarks/background-removal/scripts/benchmark_lib.py', 'src/shared/contracts/index.ts', 'node_modules/typescript/lib/tsc.js']
      .every(path=>existsSync(join(this.config.root,path)))
  }

  private implementationHash(): Promise<string> {
    return this.implementation ??= (async()=>{
      const hash=createHash('sha256').update('desktop-task-queue/1')
      // A completed task from another implementation cannot silently win admission.
      const walk=async(path:string):Promise<void>=>{
        if(!existsSync(path)) return
        const info=await stat(path)
        if(info.isDirectory()) {
          for(const name of (await readdir(path)).sort()) if(!['__pycache__','node_modules','.git'].includes(name)) await walk(join(path,name))
        } else if(/\.(py|ts|json)$/.test(path)) { hash.update(path.slice(this.config.root.length)); hash.update(await readFile(path)) }
      }
      for(const path of ['backend/fabrication','benchmarks/fabrication-layer-decomposition/algorithm-v1',
        'benchmarks/fabrication-layer-decomposition/tools','benchmarks/background-removal/scripts','src/shared','package-lock.json']) await walk(join(this.config.root,path))
      hash.update(JSON.stringify([this.config.python,this.config.backgroundPython,this.config.modelCache]))
      return hash.digest('hex')
    })()
  }

  private initialize(): Promise<void> {
    return this.initialized ??= (async () => {
      if (!this.config.jobsRoot) throw new Error('算法环境未配置：任务存储目录缺失。')
      await mkdir(this.config.jobsRoot, { recursive: true })
      for (const name of await readdir(this.config.jobsRoot)) {
        if (!/^[a-f\d-]{36}$/i.test(name)) continue
        const folder = join(this.config.jobsRoot, name)
        if (!existsSync(join(folder, 'request.json'))) continue // legacy completed jobs remain resumable by ID
        const request = JSON.parse(await readFile(join(folder, 'request.json'), 'utf8')) as RequestRecord
        if (!['embedded-alpha', 'birefnet-general'].includes(request.mode) || !/^[a-f\d]{64}$/.test(request.key) || !/^[a-f\d]{64}$/.test(request.inputHash)) throw new Error('任务记录损坏，请保留本地任务目录。')
        const job = JSON.parse(await readFile(join(folder, 'desktop-job.json'), 'utf8')) as FabricationJob
        if (job.id !== name) throw new Error('任务身份不匹配。')
        job.binding = validateBinding(JSON.parse(await readFile(join(folder, 'scene-binding.json'), 'utf8')))
        if (['queued', 'background', 'fabrication'].includes(job.status)) {
          job.status = 'failed'; job.message = '上次运行被中断；输入已保留，请点击重试从头处理，不会把部分结果当成完成。'
          delete job.result
          await this.persist(job)
        } else if (job.status === 'complete') {
          await this.readCompleted(name) // validate persisted view before accepting a completion
        } else if (!['failed', 'timeout'].includes(job.status)) throw new Error('任务状态损坏。')
        this.jobs.set(name, job); this.requests.set(name, request)
      }
    })()
  }

  async list(): Promise<FabricationJob[]> {
    await this.initialize()
    return [...this.jobs.values()].sort((a,b)=>a.startedAt-b.startedAt).map(job=>structuredClone(job))
  }

  private async persist(job: FabricationJob): Promise<void> {
    const folder = join(this.config.jobsRoot, job.id)
    const temp = join(folder, `job-${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(job), { flag: 'wx' })
    await rename(temp, join(folder, 'desktop-job.json'))
  }

  async retry(id: string): Promise<FabricationJob> {
    await this.initialize()
    const job = this.status(id), request = this.requests.get(id)
    if (!request) throw new Error('旧任务没有保留重试输入，请重新选择原图。')
    if (!['failed','timeout'].includes(job.status)) return job
    const bytes = await readFile(join(this.config.jobsRoot, id, 'input.bin'))
    if (createHash('sha256').update(bytes).digest('hex') !== request.inputHash) throw new Error('原始任务输入已变化，拒绝重试。')
    return this.submit(bytes, request.mode, job.binding, true, job.ownerUserId)
  }

  async start(bytes: unknown, mode: ForegroundMode, rawBinding?: unknown, ownerUserId?: string): Promise<FabricationJob> {
    return this.submit(bytes, mode, rawBinding, false, ownerUserId)
  }

  private async submit(bytes: unknown, mode: ForegroundMode, rawBinding: unknown, retry: boolean, ownerUserId?: string): Promise<FabricationJob> {
    validateStart(bytes, mode)
    const binding = validateBinding(rawBinding)
    if (ownerUserId && binding && binding.scene.userId !== ownerUserId) throw new Error('任务来源不属于当前账号。')
    const immutableBytes = new Uint8Array(bytes)
    const operation = this.admission.then(async () => {
    if(this.stopping) throw new Error('应用正在退出，未创建新任务。')
    await this.initialize()
    const inputHash = createHash('sha256').update(immutableBytes).digest('hex')
    const key = createHash('sha256').update(JSON.stringify({ implementation: await this.implementationHash(), inputHash, mode, ownerUserId, source: elementSourceIdentity(binding) })).digest('hex')
    const existing = [...this.jobs.values()].sort((a,b)=>b.startedAt-a.startedAt).find(job => this.requests.get(job.id)?.key === key && (!retry || !['failed','timeout'].includes(job.status)))
    if (existing) return structuredClone(existing)
    if ([...this.jobs.values()].filter(j=>j.status==='queued').length >= 20) throw new Error('等待处理的图片已达20张，请等待部分完成后重试。')
    if (this.config.requireRuntimeFiles && !this.runtimeFilesPresent()) throw new Error(this.availability().message)
    if (!existsSync(this.config.python) || (mode === 'birefnet-general' &&
        (!existsSync(this.config.backgroundPython) || !existsSync(this.config.modelCache)))) {
      throw new Error('算法环境未配置：需要 Python 环境和已安装的 BiRefNet General 模型，不会自动下载或换模型。')
    }
      const id = randomUUID()
      const folder = join(this.config.jobsRoot, id)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'input.bin'), immutableBytes, { flag: 'wx' })
      await writeFile(join(folder, 'scene-binding.json'), JSON.stringify(binding), { flag: 'wx' })
      const job: FabricationJob = { id, status: 'queued', message: '已排队，前一张结束后自动处理', startedAt: Date.now(), binding, mode, ...(ownerUserId ? { ownerUserId } : {}) }
      const request = { key, mode, inputHash }
      await this.persist(job)
      await writeFile(join(folder, 'request.json'), JSON.stringify(request), { flag: 'wx' })
      this.requests.set(id, request)
      this.jobs.set(id, job)
      this.drain()
      return { ...job }
    })
    this.admission = operation.catch(() => undefined)
    return operation
  }

  private drain(): void {
    if (this.active || this.stopping) return
    const next = [...this.jobs.values()].find(job=>job.status==='queued')
    if (!next) return
    this.active = true
    this.running = this.run(next, this.requests.get(next.id)!.mode, join(this.config.jobsRoot, next.id))
  }

  status(id: string): FabricationJob {
    const job = this.jobs.get(id)
    if (!job) throw new Error('本次会话中不存在该处理任务。')
    return structuredClone(job)
  }

  /** Restore this app's completed local job for display, not a new algorithm PASS. */
  async resume(id: string): Promise<FabricationJob> {
    await this.initialize()
    if (this.jobs.has(id)) return this.status(id)
    return this.readCompleted(id)
  }

  private async readCompleted(id: string): Promise<FabricationJob> {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error('无效任务 ID。')
    const base = await realpath(this.config.jobsRoot)
    const folder = await realpath(join(base, id))
    if (!folder.startsWith(base + sep)) throw new Error('非法任务路径。')
    const job = JSON.parse(await readFile(join(folder, 'desktop-job.json'), 'utf8')) as FabricationJob
    const view = JSON.parse(await readFile(join(folder, 'view.json'), 'utf8')) as FabricationView
    if (job.id !== id || job.status !== 'complete' || JSON.stringify(job.result) !== JSON.stringify(view) ||
        view.schemaVersion !== 'desktop-fabrication-view/1' || view.geometryStatus !== 'PASS' || view.productionExportEligible !== false) throw new Error('未找到完整且一致的本地结果。')
    initialColors(view)
    this.jobs.set(id, job)
    return this.status(id)
  }

  async cuttingGeometry(id: string) {
    const job = await this.readCompleted(id)
    const base = await realpath(join(this.config.jobsRoot, id))
    const path = await realpath(join(base, 'fabrication', 'fabrication-result.json'))
    if (!path.startsWith(base + sep) || (await stat(path)).size > 100 * 1024 * 1024) throw new Error('裁片数据路径或大小无效。')
    return readCuttingGeometry(JSON.parse(await readFile(path, 'utf8')), job.result!)
  }

  async colors(id: string): Promise<LayerColors> {
    const job = this.status(id)
    if (job.status !== 'complete' || !job.result) throw new Error('结果尚未完成。')
    const folder = join(this.config.jobsRoot, id)
    let binding = null
    try { binding = validateBinding(JSON.parse(await readFile(join(folder, 'scene-binding.json'), 'utf8'))) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const canonical = initialColors(job.result, binding)
    try { return validateColors(JSON.parse(await readFile(join(folder, 'layer-colors.json'), 'utf8')), canonical) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return canonical }
  }

  async saveColors(id: string, raw: unknown): Promise<LayerColors> {
    if (this.colorWrites.has(id)) throw new Error('换色记录正在保存。')
    this.colorWrites.add(id)
    try {
      const current = await this.colors(id)
      const next = validateColors(raw, current)
      if (next.revision !== current.revision) throw new Error('换色版本已更新，请重新读取。')
      next.revision++
      const folder = join(this.config.jobsRoot, id)
      const temp = join(folder, `layer-colors-${randomUUID()}.tmp`)
      await writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx' })
      await rename(temp, join(folder, 'layer-colors.json'))
      return next
    } finally { this.colorWrites.delete(id) }
  }

  private stage(folder: string, stage: string, mode: ForegroundMode): Promise<void> {
    return new Promise((done, fail) => {
      const python = stage === 'background' && mode === 'birefnet-general'
        ? this.config.backgroundPython : this.config.python
      const args = [join(this.config.root, 'backend/fabrication/worker.py'), '--job', folder,
        '--stage', stage, '--mode', mode]
      if (mode === 'birefnet-general') args.push('--model-cache', this.config.modelCache)
      const proc = spawn(python, args, { cwd: this.config.root, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, shell: false })
      const stdout = createWriteStream(join(folder, `${stage}.stdout.log`))
      const stderr = createWriteStream(join(folder, `${stage}.stderr.log`))
      proc.stdout.pipe(stdout); proc.stderr.pipe(stderr)
      for (const stream of [stdout, stderr]) stream.once('error', (error) => {
        proc.kill(); fail(new Error(`无法保存运行日志：${error.message}`))
      })
      let timedOut = false
      const stop = () => {
        if (process.platform === 'win32' && proc.pid) {
          const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
          killer.on('error', () => proc.kill())
        } else proc.kill('SIGKILL')
      }
      this.stopWorker = stop
      const timer = setTimeout(() => { timedOut = true; stop() }, this.config.timeoutMs ?? 600_000)
      proc.once('error', (error) => { clearTimeout(timer); stdout.end(); stderr.end(); fail(error) })
      proc.once('close', (code) => {
        this.stopWorker = undefined
        clearTimeout(timer); stdout.end(); stderr.end()
        if (this.stopping) fail(new Error('应用已关闭，处理被中断；输入已保留，可在任务列表重试。'))
        else if (timedOut) fail(new Error('TIMEOUT'))
        else if (code !== 0) fail(new Error(`${stage} 阶段失败（退出码 ${code}），原始日志已保留。`))
        else done()
      })
    })
  }

  private async run(job: FabricationJob, mode: ForegroundMode, folder: string): Promise<void> {
    try {
      job.status = 'background'
      job.message = mode === 'birefnet-general' ? 'BiRefNet General 去背景中' : '检查已有透明前景'
      await this.persist(job)
      if(this.stopping) throw new Error('应用已关闭，处理被中断；输入已保留，可重试。')
      await this.stage(folder, 'background', mode)
      job.status = 'fabrication'; job.message = '计算设计色、完整底板、裁片与制作步骤，并独立回读验证'
      await this.persist(job)
      if(this.stopping) throw new Error('应用已关闭，处理被中断；输入已保留，可重试。')
      await this.stage(folder, 'fabrication', mode)
      const result = JSON.parse(await readFile(join(folder, 'view.json'), 'utf8')) as FabricationView
      if (result.schemaVersion !== 'desktop-fabrication-view/1' || result.geometryStatus !== 'PASS' ||
          result.productionExportEligible !== false) throw new Error('处理结果不满足展示合同。')
      job.result = result; job.status = 'complete'; job.message = '几何验证完成；视觉效果仍待人工确认'
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败'
      job.status = message === 'TIMEOUT' ? 'timeout' : 'failed'
      job.message = message === 'TIMEOUT' ? '超过统一阶段预算（600秒），未将部分结果当成成功。' : message
    } finally {
      try { await this.persist(job) }
      catch { job.message += '；任务摘要保存失败，请保留当前窗口中的结果。' }
      this.active = false
      this.drain()
    }
  }

  async asset(id: string, key: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const job = this.status(id)
    const name = key === 'foreground' && job.status !== 'background' ? 'foreground.png' : job.result?.assets[key]
    if (typeof name !== 'string' || !name) throw new Error('该产物尚未就绪。')
    const base = await realpath(join(this.config.jobsRoot, id))
    const path = await realpath(resolve(base, name))
    if (!path.startsWith(base + sep) || !['.png', '.svg'].includes(extname(path))) throw new Error('非法产物。')
    if ((await stat(path)).size > 30 * 1024 * 1024) throw new Error('产物超过展示大小限制。')
    const bytes = await readFile(path)
    return { bytes, mime: extname(path) === '.svg' ? 'image/svg+xml' : 'image/png' }
  }
}

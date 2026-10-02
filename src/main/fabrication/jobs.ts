import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, writeFile, readFile, realpath, stat, rename } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FabricationJob, FabricationView, ForegroundMode } from '@shared/fabrication-desktop'
import { initialColors, validateBinding, validateColors, type LayerColors } from '@shared/fabrication-colors'

export interface RuntimeConfig {
  root: string
  jobsRoot: string
  python: string
  backgroundPython: string
  modelCache: string
  timeoutMs?: number
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

/** One bounded job at a time; no renderer-supplied paths, shell, or recipe flags. */
export class FabricationJobs {
  private jobs = new Map<string, FabricationJob>()
  private active = false
  private colorWrites = new Set<string>()
  constructor(private config: RuntimeConfig) {}

  async start(bytes: unknown, mode: ForegroundMode, rawBinding?: unknown): Promise<FabricationJob> {
    validateStart(bytes, mode)
    const binding = validateBinding(rawBinding)
    if (this.active) throw new Error('已有图片正在处理，请等待本次完成。')
    if (!existsSync(this.config.python) || (mode === 'birefnet-general' &&
        (!existsSync(this.config.backgroundPython) || !existsSync(this.config.modelCache)))) {
      throw new Error('算法环境未配置：需要 Python 环境和已安装的 BiRefNet General 模型，不会自动下载或换模型。')
    }
    this.active = true
    try {
      const id = randomUUID()
      const folder = join(this.config.jobsRoot, id)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'input.bin'), bytes, { flag: 'wx' })
      await writeFile(join(folder, 'scene-binding.json'), JSON.stringify(binding), { flag: 'wx' })
      const job: FabricationJob = { id, status: 'background', message: '正在准备前景', startedAt: Date.now() }
      this.jobs.set(id, job)
      void this.run(job, mode, folder)
      return { ...job }
    } catch (error) { this.active = false; throw error }
  }

  status(id: string): FabricationJob {
    const job = this.jobs.get(id)
    if (!job) throw new Error('本次会话中不存在该处理任务。')
    return { ...job }
  }

  /** Restore this app's completed local job for display, not a new algorithm PASS. */
  async resume(id: string): Promise<FabricationJob> {
    if (this.jobs.has(id)) return this.status(id)
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
      const timer = setTimeout(() => {
        timedOut = true
        if (process.platform === 'win32' && proc.pid) {
          const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
          killer.on('error', () => proc.kill())
        } else proc.kill('SIGKILL')
      }, this.config.timeoutMs ?? 600_000)
      proc.once('error', (error) => { clearTimeout(timer); stdout.end(); stderr.end(); fail(error) })
      proc.once('close', (code) => {
        clearTimeout(timer); stdout.end(); stderr.end()
        if (timedOut) fail(new Error('TIMEOUT'))
        else if (code !== 0) fail(new Error(`${stage} 阶段失败（退出码 ${code}），原始日志已保留。`))
        else done()
      })
    })
  }

  private async run(job: FabricationJob, mode: ForegroundMode, folder: string): Promise<void> {
    try {
      job.message = mode === 'birefnet-general' ? 'BiRefNet General 去背景中' : '检查已有透明前景'
      await this.stage(folder, 'background', mode)
      job.status = 'fabrication'; job.message = '计算设计色、完整底板、裁片与制作步骤，并独立回读验证'
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
      this.active = false
      try { await writeFile(join(folder, 'desktop-job.json'), JSON.stringify(job, null, 2)) }
      catch { job.message += '；任务摘要保存失败，请保留当前窗口中的结果。' }
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

// Real public UI -> preload -> Main -> Python -> persisted replay smoke.
// No mock results, model downloads or reference palette. Evidence stays outside checkout.
const { createRequire } = require('node:module')
const { resolve, join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const localRequire = createRequire(resolve('..', 'node_modules', 'playwright', 'package.json'))
const { _electron: electron } = localRequire('playwright')

async function main() {
  const source = process.argv[2]
  const evidence = resolve(process.argv[3])
  const expectOpaqueRejection = process.argv[4] === 'embedded-alpha-rejection'
  if (!source || !process.argv[3]) throw new Error('usage: node scripts/check-fabrication-electron.cjs INPUT EVIDENCE_DIR')
  mkdirSync(evidence, { recursive: true })
  const env = { ...process.env, TYPESCRIPT_TSC: resolve('node_modules/typescript/lib/tsc.js'),
    NODE_PATH: resolve('node_modules'), PYTHONIOENCODING: 'utf-8' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${join(evidence, 'electron-profile')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  try {
    await page.getByRole('button', { name: '去背景与分层', exact: true }).click()
    await page.locator('input[type=file]').setInputFiles(resolve(source))
    if (expectOpaqueRejection) await page.locator('select').selectOption('embedded-alpha')
    await page.screenshot({ path: join(evidence, '01-input.png') })
    await page.getByRole('button', { name: '开始处理', exact: true }).click()
    let last = ''
    const deadline = Date.now() + 1_230_000
    let job
    while (Date.now() < deadline) {
      job = await page.evaluate(async () => {
        const id = sessionStorage.getItem('felt-fabrication-job')
        return id ? window.electronAPI.fabrication.status(id) : null
      })
      if (job && job.status !== last) { last = job.status; console.log(JSON.stringify({ status: last, message: job.message })) }
      if (job && ['complete', 'failed', 'timeout'].includes(job.status)) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    writeFileSync(join(evidence, 'job.json'), JSON.stringify(job, null, 2))
    if (expectOpaqueRejection) {
      if (job?.status !== 'failed' || job.result) throw new Error('Opaque input was not rejected')
      await page.getByRole('alert').filter({ hasText: '本次未完成' }).waitFor()
      await page.screenshot({ path: join(evidence, 'opaque-rejected.png') })
      if (await page.getByRole('button', { name: '3D 展开', exact: true }).count()) throw new Error('Failure showed stale results')
      console.log('REAL_OPAQUE_REJECTION_UI_PASS')
      return
    }
    if (job?.status !== 'complete') throw new Error(`Real pipeline did not complete: ${job?.message}`)
    await page.getByText('单色制作步骤（不是原图的历史图层）', { exact: true }).waitFor({ timeout: 60000 })
    await page.locator('.summary').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, '02-results.png') })
    await page.locator('.images').nth(1).screenshot({ path: join(evidence, '02a-actual-pieces.png') })
    await page.getByRole('button', { name: '3D 展开', exact: true }).click()
    await page.locator('canvas.projection-three-canvas').waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.locator('.stage').screenshot({ path: join(evidence, '03-explode.png') })
    await page.locator('.stage input[type=range]').fill('80')
    await page.getByRole('button', { name: '隐藏首个制作步骤（仅影响显示）' }).click()
    await page.getByRole('button', { name: '显示首个制作步骤（仅影响显示）' }).click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.setViewportSize({ width: 960, height: 640 })
    await page.locator('.summary').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, '04-compact.png') })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    writeFileSync(join(evidence, 'browser-checks.json'), JSON.stringify({ errors, overflow,
      testedViewports: ['1180x760', '960x640'], mockResults: false, realPipeline: true }, null, 2))
    if (errors.length || overflow) throw new Error('Browser errors or document overflow')
    console.log('REAL_ELECTRON_PIPELINE_AND_DISPLAY_PASS')
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

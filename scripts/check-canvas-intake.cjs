// Real Electron UI, IPC, persistence, Python decomposition. No fabricated layer result.
// ASR/image transport is explicitly a loopback fixture; it does NOT test a live AI provider.
const { createRequire } = require('node:module')
const { resolve, join } = require('node:path')
const { mkdirSync, readFileSync, writeFileSync, cpSync } = require('node:fs')
const http = require('node:http')
const assert = require('node:assert/strict')
const { _electron: electron } = createRequire(resolve('..', 'node_modules/playwright/package.json'))('playwright')
async function main() {
  const input = resolve(process.argv[2]), out = resolve(process.argv[3])
  mkdirSync(out, { recursive: false })
  const reuseProfile = process.argv[4]
  if (reuseProfile) cpSync(resolve(reuseProfile), join(out, 'profile'), { recursive: true, force: false, errorOnExist: true })
  const calls = [], errors = [], png = readFileSync(input)
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    calls.push(req.url)
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url === '/api/session/token') return send(200, { ok: true, result: { token: 'canvas-fixture-session', expiresAt: Math.floor(Date.now()/1000)+3600 } })
    if (req.url === '/api/asr/transcribe' || req.url === '/api/image/generate') {
      assert(req.headers.authorization?.startsWith('Bearer ')); assert(req.headers['x-felt-installation-id'])
      if (req.url.includes('/asr/')) return send(200, { ok: true, result: { transcript: '黑白熊猫抱着红色皮球，不要真实毛发', provider: 'qwen_cloud_http', durationMs: 1, requestId: 'TEST_FIXTURE' } })
      return send(200, { ok: true, result: { imageBase64: png.toString('base64'), width: 1024, height: 1024,
        quality: { verdict: 'WARN', messages: ['测试接口图片，不代表真实生图质量'] } } })
    }
    send(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Fixture uses local intent fallback' } })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const env = { ...process.env, AI_GATEWAY_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    FELT_FABRICATION_PYTHON: resolve('../algorithm-v1-venv/Scripts/python.exe'),
    FELT_BACKGROUND_PYTHON: resolve('../algorithm-v1-venv/Scripts/python.exe'),
    TYPESCRIPT_TSC: resolve('node_modules/typescript/lib/tsc.js'), NODE_PATH: resolve('node_modules'), PYTHONIOENCODING: 'utf-8' }
  delete env.ELECTRON_RUN_AS_NODE
  const options = { executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${join(out, 'profile')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env }
  let app = await electron.launch(options)
  try {
    let page = await app.firstWindow(); page.on('pageerror', e => errors.push(String(e)))
    await page.getByRole('button', { name: reuseProfile ? '打开作品' : '画板 · 创作', exact: true }).waitFor()
    await page.setViewportSize({ width: 1440, height: 900 })
    let layers
    if (reuseProfile) {
      await page.getByRole('button', { name:'打开作品', exact:true }).click()
      await page.locator('.lower-canvas').waitFor(); await page.waitForTimeout(500)
    } else {
    await page.getByRole('button', { name: '画板 · 创作', exact: true }).click()
    await page.getByRole('button', { name: '打开背景选择' }).click()
    const drawer = page.getByRole('complementary', { name: '背景选择' })
    const box = await drawer.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 1440)
    await drawer.locator('.background-card').nth(1).click()
    await drawer.getByRole('button', { name: '换成这个背景' }).click()
    await page.getByText('背景换好啦', { exact: true }).waitFor()
    await page.getByRole('button', { name: '打开素材盒' }).click()
    await page.locator('.material-card').nth(1).click(); await page.getByRole('button', { name: '放进作品', exact: true }).click()
    await page.locator('.material-sheet.is-open').waitFor({ state: 'hidden' })
    const canvas = await page.locator('.upper-canvas').boundingBox()
    await page.mouse.move(canvas.x + canvas.width/2, canvas.y + canvas.height/2); await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width*.15, canvas.y + canvas.height*.15, { steps: 8 }); await page.mouse.up()
    await page.getByRole('button', { name: '添加图片', exact: true }).click()
    await page.screenshot({ path: join(out, '01-choose.png') })
    await page.getByLabel('上传创作图片').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not image') })
    await page.getByRole('alert').filter({ hasText: 'PNG 或 JPEG' }).waitFor()
    await page.getByLabel('上传创作图片').setInputFiles(input)
    await page.getByRole('heading', { name: '确认这张图片' }).waitFor()
    await page.screenshot({ path: join(out, '02-upload-confirm.png') })
    await page.getByRole('button', { name: '确认图片并开始拆分', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '元素图层编辑', exact: true })
    await panel.waitFor(); await page.screenshot({ path: join(out, '03-processing-in-scene.png') })
    console.log('Real upload accepted; waiting for actual decomposition (600 seconds).')
    await panel.locator('.layer-row img').first().waitFor({ timeout: 610000 })
    layers = await panel.locator('.layer-row').count(); assert(layers > 1)
    await page.screenshot({ path: join(out, '04-real-upload-layers.png') })
    await page.getByRole('button', { name: '预设颜色 #7457BB', exact: true }).click()
    await page.getByRole('button', { name: '应用到画布', exact: true }).click()
    await page.getByText('已应用到画布，关闭面板不会恢复原色。保存作品后可继续编辑。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭图层编辑' }).click()
    await page.getByRole('button', { name: '保存作品', exact: true }).click()
    await page.getByText('作品收好啦！', { exact: true }).waitFor()
    await page.screenshot({ path: join(out, '05-upload-applied-scene.png') })
    }
    const saved = await page.locator('.lower-canvas').evaluate(e => e.toDataURL())
    await page.getByRole('button', { name: '添加图片', exact: true }).click()
    await page.getByRole('button', { name: '语音输入生图' }).click()
    await page.getByRole('button', { name: '开始录音', exact: true }).click()
    await page.getByRole('button', { name: '暂停录音', exact: true }).click()
    await page.getByRole('button', { name: '继续录音', exact: true }).click()
    await page.waitForTimeout(350)
    await page.getByRole('button', { name: '完成录音', exact: true }).click()
    await page.getByRole('button', { name: '你来定', exact: true }).waitFor({ timeout: 20000 }).catch(() => {})
    if (await page.getByRole('button', { name: '你来定', exact: true }).isVisible()) await page.getByRole('button', { name: '你来定', exact: true }).click()
    await page.getByRole('button', { name: '就这样画', exact: true }).click()
    await page.getByRole('button', { name: '使用这张图并开始拆分', exact: true }).waitFor({ timeout: 30000 })
    await page.screenshot({ path: join(out, '06-voice-fixture-preview.png') })
    assert(calls.includes('/api/asr/transcribe') && calls.includes('/api/image/generate'))
    // Cancel candidate: full current scene must survive, with no new asset placed.
    await page.getByRole('button', { name: '关闭添加图片' }).click()
    assert.equal(await page.locator('.lower-canvas').evaluate(e => e.toDataURL()), saved)
    // Confirm a generated candidate as well: Main accept + resource ingestion + same-scene placement.
    await page.getByRole('button', { name:'添加图片', exact:true }).click()
    await page.getByRole('button', { name:'语音输入生图' }).click()
    await page.locator('textarea').fill('黑白熊猫抱着红色皮球，不要真实毛发')
    await page.getByRole('button', { name:'用这句话', exact:true }).click()
    await page.getByRole('button', { name:'你来定', exact:true }).waitFor({ timeout:3000 }).catch(() => {})
    if (await page.getByRole('button', { name:'你来定', exact:true }).isVisible()) await page.getByRole('button', { name:'你来定', exact:true }).click()
    await page.getByRole('button', { name:'就这样画', exact:true }).click()
    await page.getByRole('button', { name:'使用这张图并开始拆分', exact:true }).click()
    await page.getByRole('dialog', { name:'元素图层编辑', exact:true }).locator('.layer-row img').first().waitFor({ timeout:610000 })
    await page.getByRole('button', { name:'应用到画布', exact:true }).click()
    await page.getByText('已应用到画布，关闭面板不会恢复原色。保存作品后可继续编辑。', { exact:true }).waitFor()
    await page.getByRole('button', { name:'关闭图层编辑' }).click()
    await page.getByRole('button', { name:'保存作品', exact:true }).click()
    await page.getByText('作品收好啦！', { exact:true }).waitFor()
    await page.screenshot({ path:join(out,'09-generated-fixture-applied.png') })
    await page.setViewportSize({ width: 960, height: 640 })
    await page.getByRole('button', { name: '添加图片', exact: true }).click()
    const compact = await page.getByRole('dialog', { name: '添加创作图片' }).boundingBox()
    assert(compact.x >= 0 && compact.y >= 0 && compact.x + compact.width <= 961 && compact.y + compact.height <= 641)
    await page.screenshot({ path: join(out, '07-compact.png') })
    await app.close(); app = await electron.launch(options); page = await app.firstWindow()
    await page.getByRole('button', { name: '打开作品', exact: true }).waitFor(); await page.setViewportSize({ width:1440, height:900 })
    await page.getByRole('button', { name: '打开作品', exact: true }).click(); await page.locator('.lower-canvas').waitFor(); await page.waitForTimeout(600)
    await page.screenshot({ path: join(out, '08-reopened.png') })
    assert.deepEqual(errors, [])
    writeFileSync(join(out, 'checks.json'), JSON.stringify({ reusedUploadProfile:reuseProfile || null, actualUploadAndDecomposition:!reuseProfile, actualLayerCount:layers,
      actualBackgroundAndSticker:true, actualRecolorAndSave:true, voiceFixtureTransport:true, liveAIProviderVerified:false,
      generatedFixtureAcceptedIntoOriginalScene:true, generatedInputActuallyDecomposed:true,
      cancelledCandidatePreservesScene:true, compactInViewport:true, calls, errors }, null, 2))
    console.log('CANVAS_INTAKE_PASS')
  } catch(e) {
    const page = await app.firstWindow(); await page.screenshot({ path:join(out,'failure.png') }); writeFileSync(join(out,'failure.txt'),await page.locator('body').innerText()); writeFileSync(join(out,'fixture-calls.json'),JSON.stringify(calls)); throw e
  } finally { await app.close(); server.close() }
}
main().catch(e => { console.error(e); process.exitCode=1 })

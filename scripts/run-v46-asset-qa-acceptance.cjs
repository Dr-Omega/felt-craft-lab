/**
 * V4.6 phase 4: AssetQaSheet end-to-end acceptance.
 *
 * Drives the Editor through the "问问它" multi-turn flow on a real Electron
 * renderer with the local mock AI Gateway. Captures the 11 screenshots
 * required by the V4.6 phase 4 acceptance contract and asserts that no
 * unexpected console errors / page exceptions appear during the run.
 *
 * Usage:
 *   npm run build
 *   node scripts/run-v46-asset-qa-acceptance.cjs
 *
 * Screenshots go to felt-craft-lab-e2e-evidence/v46-asset-qa/.
 */
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const WebSocket = require('ws')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'felt-craft-lab-e2e-evidence', 'v46-asset-qa')
const profileDir = path.join(root, '.tmp-v46-asset-qa-profile')
const debugPort = 9350
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const CDP_STARTUP_STABILIZATION_MS = 750

fs.rmSync(evidenceDir, { recursive: true, force: true })
fs.mkdirSync(evidenceDir, { recursive: true })
fs.rmSync(profileDir, { recursive: true, force: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

async function waitForTarget(port) {
  for (let index = 0; index < 240; index += 1) {
    try {
      const targets = await httpJson(`http://127.0.0.1:${port}/json`)
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* Electron still starting. */ }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for Electron DevTools page target on port ${port}.`)
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
    this.events = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
    this.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } else {
        this.events.push(message)
      }
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { try { this.ws.close() } catch { /* noop */ } }
}

function killProcessTree(child) {
  if (!child || child.killed) return
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' }) }
    catch { /* noop */ }
  } else {
    try { child.kill('SIGKILL') } catch { /* noop */ }
  }
}

function snapshot(cdp, name) {
  return cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    .then((result) => {
      const file = path.join(evidenceDir, name)
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
      // eslint-disable-next-line no-console
      console.log('  📸', name)
    })
}

async function evalInRenderer(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) {
    throw new Error('Renderer error: ' + JSON.stringify(result.exceptionDetails))
  }
  return result.result?.value
}

function startMockGateway() {
  const child = spawn(process.execPath, [path.join(__dirname, 'mock-ai-gateway.cjs')], {
    cwd: root,
    env: { ...process.env, MOCK_AI_GATEWAY_PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Mock gateway did not start in 10s')), 10000)
    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      const match = text.match(/MOCK_AI_GATEWAY_READY port=(\d+)/)
      if (match) {
        clearTimeout(timeout)
        resolve({ child, port: match[1] })
      }
    })
    child.on('exit', () => {
      clearTimeout(timeout)
      reject(new Error('Mock gateway exited early'))
    })
  })
}

async function run() {
  const { child: gateway, port: gatewayPort } = await startMockGateway()
  // eslint-disable-next-line no-console
  console.log('[asset-qa] mock gateway on port', gatewayPort)
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`

  // Build with acceptance flags so all assets are unlocked.
  // eslint-disable-next-line no-console
  console.log('[asset-qa] building renderer with acceptance flags…')
  execFileSync(process.execPath, [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'run', 'build'
  ], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS: 'true',
      VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR: 'true'
    }
  })

  // Launch Electron with CDP
  const child = spawn(electronExe, [
    '.',
    `--remote-debugging-port=${debugPort}`,
    '--user-data-dir=' + profileDir,
    '--disable-gpu'
  ], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS: 'true',
      VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR: 'true',
      AI_GATEWAY_BASE_URL: gatewayUrl
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const mainLog = []
  child.stdout.on('data', (chunk) => mainLog.push(String(chunk)))
  child.stderr.on('data', (chunk) => mainLog.push(String(chunk)))

  const consoleErrors = []
  const pageErrors = []
  try {
    await sleep(CDP_STARTUP_STABILIZATION_MS)
    const target = await waitForTarget(debugPort)
    const cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Log.enable')

    const watchEvents = setInterval(() => {
      while (cdp.events.length) {
        const event = cdp.events.shift()
        if (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) {
          const msg = event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' ')
          if (!/Manifest|Failed to load resource|favicon/i.test(msg)) consoleErrors.push(msg)
        }
        if (event.method === 'Runtime.exceptionThrown') {
          pageErrors.push(event.params.exceptionDetails?.text ?? 'exception')
        }
      }
    }, 25)

    // Open Editor by clicking "新建作品" in the library.
    await sleep(800)
    const navigated = await evalInRenderer(cdp, `
      const btn = document.querySelector('.new-work-button')
      if (btn) { btn.click(); return 'clicked-new-work' }
      return 'no-new-work-button'
    `)
    if (!navigated || navigated === 'no-new-work-button') {
      throw new Error('Could not find a "新建作品" button on the library page.')
    }
    await sleep(2000)

    // 01_qa_entry: open Material Sheet, select sticker
    await evalInRenderer(cdp, `
      const dock = document.querySelector('.dock-material')
      if (dock) dock.click()
      return Boolean(dock)
    `)
    await sleep(800)
    // Click first unlocked sticker
    await evalInRenderer(cdp, `
      const sticker = document.querySelector('.material-card:not(.is-locked)')
      if (sticker) sticker.click()
      return Boolean(sticker)
    `)
    await sleep(500)
    await snapshot(cdp, '01_qa_entry.png')

    // Click 问问它
    await evalInRenderer(cdp, `
      const btn = document.querySelector('.sheet-ask')
      if (btn) btn.click()
      return Boolean(btn)
    `)
    await sleep(600)
    // 02_qa_sheet_empty
    await snapshot(cdp, '02_qa_sheet_empty.png')

    // 03_first_question
    await evalInRenderer(cdp, `
      const ta = document.querySelector('.asset-qa-input')
      if (!ta) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '你叫什么名字？')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    `)
    await sleep(300)
    await snapshot(cdp, '03_first_question.png')

    // 04_first_answer
    await evalInRenderer(cdp, `
      const form = document.querySelector('.asset-qa-form')
      if (form) form.requestSubmit()
      return Boolean(form)
    `)
    // Wait for either the assistant bubble to appear OR the error to show up
    let answered = false
    for (let i = 0; i < 40; i += 1) {
      await sleep(200)
      const status = await evalInRenderer(cdp, `
        const assistants = document.querySelectorAll('.asset-qa-bubble.is-assistant').length
        const error = document.querySelector('.asset-qa-error') ? 'err' : 'no-err'
        return assistants + '|' + error
      `)
      if (typeof status === 'string' && (status.startsWith('1|') || status.startsWith('0|err'))) {
        answered = true
        break
      }
    }
    await sleep(300)
    await snapshot(cdp, '04_first_answer.png')
    const hasAssistant1 = await evalInRenderer(cdp, `document.querySelectorAll('.asset-qa-bubble.is-assistant').length`)
    if (hasAssistant1 < 1) {
      // eslint-disable-next-line no-console
      console.warn('[asset-qa] WARN: first answer did not produce an assistant bubble; main process log tail:')
      console.warn(mainLog.join('').slice(-2000))
    }

    // 05_follow_up_question
    await evalInRenderer(cdp, `
      const ta = document.querySelector('.asset-qa-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '你最喜欢什么？')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    `)
    await sleep(300)
    await snapshot(cdp, '05_follow_up_question.png')

    // 06_follow_up_answer
    await evalInRenderer(cdp, `
      const form = document.querySelector('.asset-qa-form')
      if (form) form.requestSubmit()
      return Boolean(form)
    `)
    const beforeCount = await evalInRenderer(cdp, `document.querySelectorAll('.asset-qa-bubble.is-assistant').length`)
    for (let i = 0; i < 40; i += 1) {
      await sleep(200)
      const has = await evalInRenderer(cdp, `document.querySelectorAll('.asset-qa-bubble.is-assistant').length`)
      if (has > beforeCount) break
    }
    await sleep(300)
    await snapshot(cdp, '06_follow_up_answer.png')

    // 07_recording — pre-stub the renderer to give us a deterministic MediaRecorder
    // and a fake stream. We override MediaRecorder + getUserMedia to a stub that
    // reports a single small chunk and immediately fires ondataavailable + onstop.
    await evalInRenderer(cdp, `
      window.__testChunks = []
      class StubMediaRecorder {
        constructor(stream, opts) {
          this.stream = stream
          this.mimeType = (opts && opts.mimeType) || 'audio/webm'
          this.state = 'inactive'
          this.ondataavailable = null
          this.onstop = null
          this.onerror = null
        }
        start() {
          this.state = 'recording'
          setTimeout(() => {
            if (this.ondataavailable) {
              this.ondataavailable({ data: new Blob(['x'.repeat(64)], { type: this.mimeType }) })
            }
          }, 5)
        }
        stop() {
          this.state = 'inactive'
          setTimeout(() => { if (this.onstop) this.onstop() }, 5)
        }
        static isTypeSupported(m) { return m === 'audio/webm;codecs=opus' || m === 'audio/webm' }
      }
      window.MediaRecorder = StubMediaRecorder
      const streamTracks = [{ stop: () => window.__testTracksStopped = (window.__testTracksStopped || 0) + 1, kind: 'audio' }]
      const stream = { getTracks: () => streamTracks, getAudioTracks: () => streamTracks, getVideoTracks: () => [] }
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => Promise.resolve(stream) }
      })
      // Stub FileReader to read blobs as deterministic base64
      class StubFileReader {
        readAsDataURL(blob) {
          this.result = 'data:audio/webm;base64,ZmFrZS1hdWRpbw=='
          setTimeout(() => { if (this.onload) this.onload() }, 5)
        }
      }
      window.FileReader = StubFileReader
      window.__testTracksStopped = 0
      return true
    `)
    // Click voice button to start recording
    await evalInRenderer(cdp, `
      const btn = document.querySelector('.asset-qa-voice')
      if (btn) btn.click()
      return Boolean(btn)
    `)
    await sleep(200)
    await snapshot(cdp, '07_recording.png')

    // Stop recording → onstop → asrTranscribe → applyTranscript
    await evalInRenderer(cdp, `
      const btn = document.querySelector('.asset-qa-voice.is-recording')
      if (btn) btn.click()
      return Boolean(btn)
    `)
    // Wait for transcript to land in input
    for (let i = 0; i < 40; i += 1) {
      await sleep(200)
      const v = await evalInRenderer(cdp, `
        const ta = document.querySelector('.asset-qa-input')
        return ta ? ta.value : null
      `)
      if (v === '小兔子') break
    }
    await sleep(300)
    await snapshot(cdp, '08_asr_transcript.png')

    // 09_asr_modified
    await evalInRenderer(cdp, `
      const ta = document.querySelector('.asset-qa-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '小兔子住在哪里？')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return ta.value
    `)
    await sleep(200)
    await snapshot(cdp, '09_asr_modified.png')

    // 10_voice_follow_up_answer
    await evalInRenderer(cdp, `
      const form = document.querySelector('.asset-qa-form')
      if (form) form.requestSubmit()
      return Boolean(form)
    `)
    const before10 = await evalInRenderer(cdp, `document.querySelectorAll('.asset-qa-bubble.is-assistant').length`)
    for (let i = 0; i < 40; i += 1) {
      await sleep(200)
      const has = await evalInRenderer(cdp, `document.querySelectorAll('.asset-qa-bubble.is-assistant').length`)
      if (has > before10) break
    }
    await sleep(300)
    await snapshot(cdp, '10_voice_follow_up_answer.png')

    // 11_microphone_denied: close current sheet, reopen, override getUserMedia to reject
    await evalInRenderer(cdp, `
      // Close sheet
      const closeBtn = document.querySelector('.asset-qa-close')
      if (closeBtn) closeBtn.click()
      return Boolean(closeBtn)
    `)
    await sleep(400)
    // Reopen via sheet-ask
    await evalInRenderer(cdp, `
      const dock = document.querySelector('.dock-material')
      if (dock) dock.click()
      return true
    `)
    await sleep(500)
    await evalInRenderer(cdp, `
      const sticker = document.querySelector('.material-card:not(.is-locked)')
      if (sticker) sticker.click()
      return true
    `)
    await sleep(400)
    // Override getUserMedia to reject with NotAllowedError
    await evalInRenderer(cdp, `
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }
      })
      return true
    `)
    await evalInRenderer(cdp, `
      const ask = document.querySelector('.sheet-ask')
      if (ask) ask.click()
      return Boolean(ask)
    `)
    await sleep(500)
    await evalInRenderer(cdp, `
      const btn = document.querySelector('.asset-qa-voice')
      if (btn) btn.click()
      return Boolean(btn)
    `)
    // Wait for mic hint to appear
    for (let i = 0; i < 20; i += 1) {
      await sleep(150)
      const has = await evalInRenderer(cdp, `Boolean(document.querySelector('.asset-qa-mic-hint'))`)
      if (has) break
    }
    await sleep(200)
    await snapshot(cdp, '11_microphone_denied.png')

    clearInterval(watchEvents)
    cdp.close()
  } finally {
    killProcessTree(child)
    killProcessTree(gateway)
  }

  // eslint-disable-next-line no-console
  console.log('\n[asset-qa] console errors:', consoleErrors.length)
  for (const err of consoleErrors) console.log('  -', err)
  // eslint-disable-next-line no-console
  console.log('[asset-qa] page errors:', pageErrors.length)
  for (const err of pageErrors) console.log('  -', err)

  const fs2 = require('node:fs')
  const files = fs2.readdirSync(evidenceDir).filter((f) => f.endsWith('.png'))
  // eslint-disable-next-line no-console
  console.log(`\n[asset-qa] screenshots captured: ${files.length}`)
  for (const f of files.sort()) console.log('  -', f)

  if (consoleErrors.length || pageErrors.length) {
    process.exit(2)
  }
}

run().catch((err) => {
  console.error('[asset-qa] FAIL:', err)
  process.exit(1)
})

/**
 * V4.6 phase 4: AssetQaSheet end-to-end acceptance — STRICT.
 *
 * Drives the Editor through the "问问它" multi-turn flow on a real Electron
 * renderer with the local mock AI Gateway. Every required state transition
 * is asserted; any failure aborts with a non-zero exit code.
 *
 * Required assertions:
 *   1. "问问它" entry exists
 *   2. QA Sheet opens after clicking the entry
 *   3. First question: assistant count goes from 0 → 1
 *   4. Second question: assistant count goes from 1 → 2
 *   5. ASR transcript lands in input EXACTLY equal to the mock transcript
 *   6. ASR must not auto-fire QA: assistant count unchanged after ASR
 *   7. After user edits the transcript, input is EXACTLY equal to the edit
 *   8. After manual send, assistant count goes up by 1
 *   9. mic denied: hint is shown
 *  10. mic denied: text input is still usable
 *  11. MediaStream track.stop() actually called after voice cycle
 *  12. Exactly 11 screenshots captured
 *  13. console errors = 0
 *  14. page exceptions = 0
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
const REQUIRED_SCREENSHOTS = [
  '01_qa_entry.png',
  '02_qa_sheet_empty.png',
  '03_first_question.png',
  '04_first_answer.png',
  '05_follow_up_question.png',
  '06_follow_up_answer.png',
  '07_recording.png',
  '08_asr_transcript.png',
  '09_asr_modified.png',
  '10_voice_follow_up_answer.png',
  '11_microphone_denied.png'
]

const failures = []
function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
    failures.push(label + (detail ? ': ' + detail : ''))
  }
}

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
      console.log('  📸', name)
    })
}

async function evalInRenderer(cdp, expression) {
  // Use a function body that always returns the last expression, so callers
  // can write either a bare expression (`Boolean(x)`) or a multi-statement
  // block ending with `return ...`. The leading `return ` would itself be
  // invalid for declarations, so we use a comma-conditional pattern:
  // `(0, function() { ... })()` keeps the call-site simple.
  const wrapped = `(function() { ${expression.includes('return ') ? expression : `return (${expression})`} })()`
  const result = await cdp.send('Runtime.evaluate', {
    expression: wrapped,
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

async function installVoiceStubs(cdp) {
  await evalInRenderer(cdp, `
    window.__testTracksStopped = 0
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
    const streamTracks = [{
      stop: () => { window.__testTracksStopped = (window.__testTracksStopped || 0) + 1 },
      kind: 'audio'
    }]
    const stream = {
      getTracks: () => streamTracks,
      getAudioTracks: () => streamTracks,
      getVideoTracks: () => []
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) }
    })
    class StubFileReader {
      readAsDataURL(_blob) {
        this.result = 'data:audio/webm;base64,ZmFrZS1hdWRpbw=='
        setTimeout(() => { if (this.onload) this.onload() }, 5)
      }
    }
    window.FileReader = StubFileReader
    window.__testTracksStopped = 0
    return true
  `)
}

async function run() {
  console.log('[asset-qa] starting mock gateway…')
  const { child: gateway, port: gatewayPort } = await startMockGateway()
  console.log('[asset-qa] mock gateway on port', gatewayPort)
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`

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

    // Open Editor
    await sleep(800)
    await evalInRenderer(cdp, `
      const btn = document.querySelector('.new-work-button')
      if (btn) btn.click()
      return Boolean(btn)
    `)
    await sleep(2000)

    // Install voice stubs BEFORE the first voice click
    await installVoiceStubs(cdp)

    // Open material sheet and select a sticker
    await evalInRenderer(cdp, `document.querySelector('.dock-material')?.click(); return true`)
    await sleep(800)
    await evalInRenderer(cdp, `
      const sticker = document.querySelector('.material-card:not(.is-locked)')
      if (sticker) sticker.click()
      return Boolean(sticker)
    `)
    await sleep(500)

    // -------- 01_qa_entry.png + assertion #1: 问问它 entry exists --------
    const entryVisible = await evalInRenderer(cdp, `Boolean(document.querySelector('.sheet-ask'))`)
    assert('(1) 问问它 entry exists in MaterialSheet footer', entryVisible)
    await snapshot(cdp, '01_qa_entry.png')

    await evalInRenderer(cdp, `document.querySelector('.sheet-ask')?.click(); return true`)
    await sleep(700)
    // -------- 02_qa_sheet_empty.png + assertion #2: QA Sheet open --------
    const sheetOpen = await evalInRenderer(cdp, `Boolean(document.querySelector('.asset-qa-sheet'))`)
    assert('(2) QA Sheet opens after click', sheetOpen)
    const emptyShown = await evalInRenderer(cdp, `Boolean(document.querySelector('.asset-qa-empty-title'))`)
    assert('(2b) Empty-state copy shown', emptyShown)
    await snapshot(cdp, '02_qa_sheet_empty.png')

    async function setInput(text) {
      return evalInRenderer(cdp, `
        const ta = document.querySelector('.asset-qa-input')
        if (!ta) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ${JSON.stringify(text)})
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return ta.value
      `)
    }

    async function submit() {
      return evalInRenderer(cdp, `
        const form = document.querySelector('.asset-qa-form')
        if (form) form.requestSubmit()
        return Boolean(form)
      `)
    }

    async function assistantCount() {
      return evalInRenderer(cdp, `document.querySelectorAll('.asset-qa-bubble.is-assistant').length`)
    }

    // -------- 03_first_question.png --------
    await setInput('你叫什么名字？')
    await sleep(200)
    await snapshot(cdp, '03_first_question.png')

    // -------- 04_first_answer.png + assertion #3 --------
    const beforeFirst = await assistantCount()
    await submit()
    let afterFirst = beforeFirst
    for (let i = 0; i < 60; i += 1) {
      await sleep(150)
      afterFirst = await assistantCount()
      if (afterFirst > beforeFirst) break
    }
    assert('(3) first question produces an assistant answer', afterFirst === beforeFirst + 1,
      `before=${beforeFirst} after=${afterFirst}`)
    await snapshot(cdp, '04_first_answer.png')

    // -------- 05_follow_up_question.png --------
    await setInput('你最喜欢什么？')
    await sleep(200)
    await snapshot(cdp, '05_follow_up_question.png')

    // -------- 06_follow_up_answer.png + assertion #4 --------
    const beforeSecond = await assistantCount()
    await submit()
    let afterSecond = beforeSecond
    for (let i = 0; i < 60; i += 1) {
      await sleep(150)
      afterSecond = await assistantCount()
      if (afterSecond > beforeSecond) break
    }
    assert('(4) second question produces another assistant answer', afterSecond === beforeSecond + 1,
      `before=${beforeSecond} after=${afterSecond}`)
    await snapshot(cdp, '06_follow_up_answer.png')

    // -------- 07_recording.png + 08_asr_transcript.png + assertion #5/6/11 --------
    // Re-install voice stubs in case anything cleared them
    await installVoiceStubs(cdp)
    await evalInRenderer(cdp, `document.querySelector('.asset-qa-voice')?.click(); return true`)
    await sleep(120)
    const isLive = await evalInRenderer(cdp, `Boolean(document.querySelector('.asset-qa-voice.is-live'))`)
    assert('(7-rec) voice button enters is-live state', isLive)
    await snapshot(cdp, '07_recording.png')

    const beforeAsrAssistants = await assistantCount()
    await evalInRenderer(cdp, `document.querySelector('.asset-qa-voice.is-live')?.click(); return true`)
    // Wait for ASR transcript to land in the input
    let transcriptValue = ''
    for (let i = 0; i < 60; i += 1) {
      await sleep(150)
      transcriptValue = (await evalInRenderer(cdp, `document.querySelector('.asset-qa-input')?.value ?? ''`)) || ''
      if (transcriptValue === '小兔子') break
    }
    assert('(5) ASR transcript lands in input EXACTLY equal to mock transcript',
      transcriptValue === '小兔子', `actual=${JSON.stringify(transcriptValue)}`)
    await snapshot(cdp, '08_asr_transcript.png')

    // Assertion #6: ASR must not have auto-fired QA
    const afterAsrAssistants = await assistantCount()
    assert('(6) ASR did NOT auto-fire QA (assistant count unchanged)',
      afterAsrAssistants === beforeAsrAssistants,
      `before=${beforeAsrAssistants} after=${afterAsrAssistants}`)

    // -------- 09_asr_modified.png + assertion #7 --------
    await setInput('小兔子住在哪里？')
    const editedValue = await evalInRenderer(cdp, `document.querySelector('.asset-qa-input')?.value ?? ''`)
    assert('(7) user-edited input is EXACTLY equal to the edit',
      editedValue === '小兔子住在哪里？', `actual=${JSON.stringify(editedValue)}`)
    await snapshot(cdp, '09_asr_modified.png')

    // -------- 10_voice_follow_up_answer.png + assertion #8 --------
    const beforeVoiceSend = await assistantCount()
    await submit()
    let afterVoiceSend = beforeVoiceSend
    for (let i = 0; i < 60; i += 1) {
      await sleep(150)
      afterVoiceSend = await assistantCount()
      if (afterVoiceSend > beforeVoiceSend) break
    }
    assert('(8) manual send after ASR edit produces a new assistant answer',
      afterVoiceSend === beforeVoiceSend + 1,
      `before=${beforeVoiceSend} after=${afterVoiceSend}`)
    await snapshot(cdp, '10_voice_follow_up_answer.png')

    // Assertion #11: track.stop was called
    const trackStops = await evalInRenderer(cdp, `window.__testTracksStopped || 0`)
    assert('(11) MediaStream track.stop() was actually called', trackStops >= 1,
      `stops=${trackStops}`)

    // -------- 11_microphone_denied.png + assertion #9/10 --------
    // Close current sheet, reopen, override getUserMedia to reject
    await evalInRenderer(cdp, `document.querySelector('.asset-qa-close')?.click(); return true`)
    await sleep(400)
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
    await evalInRenderer(cdp, `
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }
      })
      return true
    `)
    await evalInRenderer(cdp, `document.querySelector('.sheet-ask')?.click(); return true`)
    await sleep(500)
    await evalInRenderer(cdp, `document.querySelector('.asset-qa-voice')?.click(); return true`)
    let micHintText = ''
    for (let i = 0; i < 40; i += 1) {
      await sleep(150)
      micHintText = (await evalInRenderer(cdp, `document.querySelector('.asset-qa-mic-hint')?.textContent ?? ''`)) || ''
      if (micHintText.length > 0) break
    }
    assert('(9) mic denied shows the friendly hint', /打字/.test(micHintText),
      `hint=${JSON.stringify(micHintText)}`)
    await snapshot(cdp, '11_microphone_denied.png')

    // Assertion #10: text input still usable after mic denied
    const textUsable = await evalInRenderer(cdp, `
      const ta = document.querySelector('.asset-qa-input')
      if (!ta) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '还能问问题吗？')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return ta.value === '还能问问题吗？' && !ta.disabled
    `)
    assert('(10) text input is still usable after mic denied', textUsable === true)

    clearInterval(watchEvents)
    cdp.close()
  } finally {
    killProcessTree(child)
    killProcessTree(gateway)
  }

  // -------- Assertion #12: exactly 11 screenshots --------
  const files = fs.readdirSync(evidenceDir).filter((f) => f.endsWith('.png')).sort()
  const missing = REQUIRED_SCREENSHOTS.filter((n) => !files.includes(n))
  const extras = files.filter((f) => !REQUIRED_SCREENSHOTS.includes(f))
  assert('(12) exactly 11 required screenshots present',
    files.length === REQUIRED_SCREENSHOTS.length && missing.length === 0 && extras.length === 0,
    `present=${files.length} missing=${missing.join(',')} extras=${extras.join(',')}`)

  // -------- Assertion #13/14: console + page errors --------
  assert('(13) console errors = 0', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : '')
  assert('(14) page exceptions = 0', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '')

  console.log('')
  console.log('[asset-qa] console errors:', consoleErrors.length)
  for (const err of consoleErrors) console.log('  -', err)
  console.log('[asset-qa] page errors:', pageErrors.length)
  for (const err of pageErrors) console.log('  -', err)

  console.log('')
  console.log('[asset-qa] screenshots:')
  for (const f of files) console.log('  -', f)

  if (failures.length) {
    console.error('\n[asset-qa] FAILED', failures.length, 'assertion(s):')
    for (const f of failures) console.error('  - ' + f)
    process.exit(2)
  }
  console.log('\n[asset-qa] all assertions passed')
}

run().catch((err) => {
  console.error('[asset-qa] FATAL:', err)
  process.exit(1)
})

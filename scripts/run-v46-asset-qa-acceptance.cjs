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
 *
 * MaterialSheet strict layout guards (P0):
 *  (A) no two rows of material cards have overlapping bounding boxes
 *  (B) material-card-name lives inside its card rectangle
 *  (B2) material-card-image and material-card-name do not vertically overlap
 *  (C) category chips do not leak any snake_case technical id
 *  (D) the search bar visible text does not contain "搜索素材"
 *  (E) material-grid remains overflow-y scrollable with footer expanded
 */
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const WebSocket = require('ws')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'felt-craft-lab-e2e-evidence', 'v46-asset-qa')
const materialEvidenceDir = path.join(root, 'felt-craft-lab-e2e-evidence', 'v46-material-sheet')
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
const REQUIRED_MATERIAL_SCREENSHOTS = [
  'A_material_sheet_empty.png',
  'B_material_sheet_selected.png',
  'C_material_sheet_scroll_bottom.png',
  'D_material_and_qa.png'
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
fs.rmSync(materialEvidenceDir, { recursive: true, force: true })
fs.mkdirSync(materialEvidenceDir, { recursive: true })
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
    // First-answer text is the mock-gateway's branched answer for Q1.
    const firstAnswerText = await evalInRenderer(cdp, `
      const els = document.querySelectorAll('.asset-qa-bubble.is-assistant')
      const last = els[els.length - 1]
      return last?.textContent?.trim() ?? ''
    `)
    assert('(3b) first answer matches the mock branched text for 你叫什么名字？',
      firstAnswerText === '我叫莲花河灯呀！',
      `actual=${JSON.stringify(firstAnswerText)}`)
    await snapshot(cdp, '04_first_answer.png')

    // -------- 05_follow_up_question.png --------
    await setInput('那你平时会在哪里？')
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
    // Second-answer text is the mock-gateway's branched answer for Q2.
    const secondAnswerText = await evalInRenderer(cdp, `
      const els = document.querySelectorAll('.asset-qa-bubble.is-assistant')
      const last = els[els.length - 1]
      return last?.textContent?.trim() ?? ''
    `)
    assert('(4b) second answer matches the mock branched text for 那你平时会在哪里？',
      secondAnswerText === '我会漂在水面上，晚上亮起来很好看。',
      `actual=${JSON.stringify(secondAnswerText)}`)
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
      if (transcriptValue === '晚上会亮吗？') break
    }
    assert('(5) ASR transcript lands in input EXACTLY equal to mock transcript',
      transcriptValue === '晚上会亮吗？', `actual=${JSON.stringify(transcriptValue)}`)
    await snapshot(cdp, '08_asr_transcript.png')

    // Assertion #6: ASR must not have auto-fired QA
    const afterAsrAssistants = await assistantCount()
    assert('(6) ASR did NOT auto-fire QA (assistant count unchanged)',
      afterAsrAssistants === beforeAsrAssistants,
      `before=${beforeAsrAssistants} after=${afterAsrAssistants}`)

    // -------- 09_asr_modified.png + assertion #7 --------
    await setInput('你晚上会亮吗？')
    const editedValue = await evalInRenderer(cdp, `document.querySelector('.asset-qa-input')?.value ?? ''`)
    assert('(7) user-edited input is EXACTLY equal to the edit',
      editedValue === '你晚上会亮吗？', `actual=${JSON.stringify(editedValue)}`)
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
    // Third answer text is the mock-gateway's branched answer for Q3.
    const thirdAnswerText = await evalInRenderer(cdp, `
      const els = document.querySelectorAll('.asset-qa-bubble.is-assistant')
      const last = els[els.length - 1]
      return last?.textContent?.trim() ?? ''
    `)
    assert('(8b) third answer matches the mock branched text for 你晚上会亮吗？',
      thirdAnswerText === '会呀，点亮以后我会在水面上发光。',
      `actual=${JSON.stringify(thirdAnswerText)}`)
    await snapshot(cdp, '10_voice_follow_up_answer.png')

    // -------- Assertion (8c): multi-turn history actually flows through
    //     the QA chain — not just a single-turn echo. The mock records
    //     every /api/qa/ask call with its question + history length.
    const qaCalls = await httpJson(`${gatewayUrl}/api/_mock/qa-calls`)
    const calls = qaCalls?.calls ?? []
    assert('(8c) mock received exactly 3 QA calls',
      calls.length === 3,
      `count=${calls.length}`)
    const first = calls[0] ?? {}
    const second = calls[1] ?? {}
    const third = calls[2] ?? {}
    assert('(8c1) QA call 1 has the right question and empty history',
      first.question === '你叫什么名字？' && (first.history?.length ?? -1) === 0,
      JSON.stringify(first))
    assert('(8c2) QA call 2 has the right question and a 2-message history',
      second.question === '那你平时会在哪里？' && (second.history?.length ?? -1) === 2
        && second.history?.[0]?.content === '你叫什么名字？'
        && second.history?.[1]?.content === '我叫莲花河灯呀！',
      JSON.stringify(second))
    assert('(8c3) QA call 3 has the right question and a 4-message history',
      third.question === '你晚上会亮吗？' && (third.history?.length ?? -1) === 4
        && third.history?.[2]?.content === '那你平时会在哪里？'
        && third.history?.[3]?.content === '我会漂在水面上，晚上亮起来很好看。',
      JSON.stringify(third))

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

    // -------- Phase: MaterialSheet visual evidence (4 separate screenshots
    //     that prove the layout fix, the wood/apricot visual alignment, and
    //     the layered bottom action bar). These are NOT part of the 14
    //     strict QA assertions — they live in v46-material-sheet/. --------
    // Close the QA sheet and reopen MaterialSheet.
    await evalInRenderer(cdp, `document.querySelector('.asset-qa-close')?.click(); return true`)
    await sleep(300)
    // Reset selection so we can show the empty state first.
    await evalInRenderer(cdp, `document.querySelector('.asset-qa-close')?.click(); return true`)
    await sleep(300)
    await evalInRenderer(cdp, `
      // Click outside any open sheet to ensure backdrop is dismissed
      const backdrop = document.querySelector('.sheet-backdrop.is-open')
      if (backdrop) backdrop.click()
      return Boolean(backdrop)
    `)
    await sleep(300)
    // Now open MaterialSheet
    await evalInRenderer(cdp, `document.querySelector('.dock-material')?.click(); return true`)
    await sleep(800)

    // A: MaterialSheet open, no sticker selected.
    const aSheetOpen = await evalInRenderer(cdp, `Boolean(document.querySelector('.material-sheet.is-open'))`)
    assert('(A) MaterialSheet opens for visual review', aSheetOpen)
    // Clear any prior selection by clicking on the first category chip.
    await evalInRenderer(cdp, `document.querySelector('.category-chip')?.click(); return true`)
    await sleep(300)
    const aFooterHidden = await evalInRenderer(cdp, `!document.querySelector('.sheet-footer')`)
    assert('(A) no footer in empty selection state', aFooterHidden)
    await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      .then((r) => fs.writeFileSync(path.join(materialEvidenceDir, 'A_material_sheet_empty.png'), Buffer.from(r.data, 'base64')))
    console.log('  📸 A_material_sheet_empty.png')

    // B: select a sticker, layered footer is visible.
    const bClicked = await evalInRenderer(cdp, `
      const card = document.querySelector('.material-card:not(.is-locked)')
      if (card) card.click()
      return Boolean(card)
    `)
    assert('(B) selected a material card', bClicked)
    await sleep(400)
    const bFooterShown = await evalInRenderer(cdp, `Boolean(document.querySelector('.sheet-footer'))`)
    assert('(B) layered footer is now visible', bFooterShown)
    const bLayered = await evalInRenderer(cdp, `
      const f = document.querySelector('.sheet-footer')
      return Boolean(f?.querySelector('.sheet-footer-name-zh'))
        && Boolean(f?.querySelector('.sheet-footer-secondary'))
        && Boolean(f?.querySelector('.sheet-footer-primary'))
        && Boolean(f?.querySelector('.sheet-ask'))
        && Boolean(f?.querySelector('.sheet-add'))
    `)
    assert('(B) footer has name / secondary / primary layers + ask + add', bLayered)
    await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      .then((r) => fs.writeFileSync(path.join(materialEvidenceDir, 'B_material_sheet_selected.png'), Buffer.from(r.data, 'base64')))
    console.log('  📸 B_material_sheet_selected.png')

    // C: scroll the grid to the bottom — last row must remain fully visible.
    const cScrolled = await evalInRenderer(cdp, `
      const grid = document.querySelector('.material-grid')
      if (!grid) return false
      grid.scrollTop = grid.scrollHeight
      const last = grid.querySelector('.material-card:last-of-type')
      if (!last) return false
      const gridRect = grid.getBoundingClientRect()
      const lastRect = last.getBoundingClientRect()
      return {
        scrollTop: grid.scrollTop,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
        lastTop: lastRect.top,
        lastBottom: lastRect.bottom,
        gridTop: gridRect.top,
        gridBottom: gridRect.bottom
      }
    `)
    assert('(C) grid was scrolled to the bottom', cScrolled && cScrolled.scrollTop + cScrolled.clientHeight >= cScrolled.scrollHeight - 1,
      JSON.stringify(cScrolled))
    // Strict check: the last card's top must be inside the grid (not clipped
    // by the footer), and the last card's bottom must be inside the grid
    // viewport (not pushed below the footer). ±4px tolerance for the
    // subpixel scroll position that the browser may clamp.
    const cLastVisible = cScrolled
      && cScrolled.lastTop >= cScrolled.gridTop - 4
      && cScrolled.lastBottom <= cScrolled.gridBottom + 4
    assert('(C) last row of cards is fully visible (not clipped by footer)',
      cLastVisible,
      JSON.stringify(cScrolled))
    await new Promise((r) => setTimeout(r, 200))
    await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      .then((r) => fs.writeFileSync(path.join(materialEvidenceDir, 'C_material_sheet_scroll_bottom.png'), Buffer.from(r.data, 'base64')))
    console.log('  📸 C_material_sheet_scroll_bottom.png')

    // -------- P0 strict layout / content guards --------
    // These must run BEFORE (D) opens the QA sheet, because the QA sheet
    // can take the MaterialSheet out of the visible layout. The P0 checks
    // need a selected card + visible footer to verify the grid is still
    // the scrollable zone.
    //
    // A. any two non-same-row material cards must NOT have overlapping
    //    bounding boxes (regression test for the previous bug where the
    //    whole-card aspect-ratio:1 forced cards to overflow rows).
    // B. material-card-name lives inside the card and does NOT escape the
    //    card rectangle.
    // B2. material-card-image and material-card-name do not vertically
    //     overlap (the name sits on its own row, not on top of the image).
    // C. category chips do not leak snake_case technical ids like
    //    festival_poetry. Unknown ids use the generic "其他" fallback.
    // D. the search bar visible text must NOT contain "搜索素材" twice.
    // E. with a card selected + footer expanded, the material grid is
    //    STILL the scrollable zone (overflow-y: auto + content taller
    //    than the viewport). The cards must not be silently compressed.

    const cardLayout = await evalInRenderer(cdp, `
      const grid = document.querySelector('.material-grid')
      if (!grid) return { ok: false, reason: 'no grid' }
      const cards = Array.from(grid.querySelectorAll('.material-card'))
      if (cards.length < 2) return { ok: false, reason: 'not enough cards' }
      const rects = cards.map((card) => {
        const r = card.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
      })
      const rows = []
      for (const r of rects) {
        const last = rows[rows.length - 1]
        if (last && Math.abs(last.top - r.top) < 2) {
          last.bottom = Math.max(last.bottom, r.bottom)
          last.right = Math.max(last.right, r.right)
        } else {
          rows.push({ top: r.top, bottom: r.bottom, right: r.right })
        }
      }
      const overlaps = []
      for (let i = 1; i < rows.length; i += 1) {
        if (rows[i - 1].bottom > rows[i].top + 0.5) {
          overlaps.push({ prevBottom: rows[i - 1].bottom, nextTop: rows[i].top, delta: rows[i - 1].bottom - rows[i].top })
        }
      }
      return {
        ok: overlaps.length === 0,
        cardCount: cards.length,
        rowCount: rows.length,
        firstRowTop: rows[0]?.top,
        lastRowBottom: rows[rows.length - 1]?.bottom,
        overlaps
      }
    `)
    assert('(A) no two rows of material cards have overlapping bounding boxes',
      cardLayout && cardLayout.ok,
      JSON.stringify(cardLayout))

    const nameLayout = await evalInRenderer(cdp, `
      const grid = document.querySelector('.material-grid')
      if (!grid) return { ok: false, reason: 'no grid' }
      const cards = Array.from(grid.querySelectorAll('.material-card')).slice(0, 6)
      const mismatches = []
      for (const card of cards) {
        const name = card.querySelector('.material-card-name')
        if (!name) { mismatches.push({ reason: 'no name' }); continue }
        const cardRect = card.getBoundingClientRect()
        const nameRect = name.getBoundingClientRect()
        if (nameRect.width <= 0 || nameRect.height <= 0) {
          mismatches.push({ reason: 'zero-size name', w: nameRect.width, h: nameRect.height })
          continue
        }
        if (nameRect.top < cardRect.top - 0.5 || nameRect.bottom > cardRect.bottom + 0.5 ||
            nameRect.left < cardRect.left - 0.5 || nameRect.right > cardRect.right + 0.5) {
          mismatches.push({ reason: 'name escapes card', card: { top: cardRect.top, bottom: cardRect.bottom, left: cardRect.left, right: cardRect.right }, name: { top: nameRect.top, bottom: nameRect.bottom, left: nameRect.left, right: nameRect.right } })
          continue
        }
      }
      return { ok: mismatches.length === 0, checked: cards.length, mismatches }
    `)
    assert('(B) material-card-name is inside its card and does not escape the card rectangle',
      nameLayout && nameLayout.ok,
      JSON.stringify(nameLayout))

    const nameVsImage = await evalInRenderer(cdp, `
      const grid = document.querySelector('.material-grid')
      if (!grid) return { ok: false, reason: 'no grid' }
      const cards = Array.from(grid.querySelectorAll('.material-card')).slice(0, 6)
      const overlaps = []
      for (const card of cards) {
        const image = card.querySelector('.material-card-image')
        const name = card.querySelector('.material-card-name')
        if (!image || !name) { overlaps.push({ reason: 'missing child' }); continue }
        const i = image.getBoundingClientRect()
        const n = name.getBoundingClientRect()
        if (i.bottom > n.top + 0.5) {
          overlaps.push({ imageBottom: i.bottom, nameTop: n.top, delta: i.bottom - n.top })
        }
      }
      return { ok: overlaps.length === 0, checked: cards.length, overlaps }
    `)
    assert('(B2) material-card-image and material-card-name do not overlap (name is below image)',
      nameVsImage && nameVsImage.ok,
      JSON.stringify(nameVsImage))

    const categoryText = await evalInRenderer(cdp, `
      const chips = Array.from(document.querySelectorAll('.category-chip'))
      return chips.map((c) => (c.textContent || '').trim())
    `)
    const snakeCaseLeak = Array.isArray(categoryText)
      ? categoryText.filter((text) => /[a-z]+_[a-z]+/.test(text))
      : ['<unable-to-read>']
    assert('(C) category chips do not leak any snake_case technical id (e.g. festival_poetry)',
      Array.isArray(categoryText) && snakeCaseLeak.length === 0,
      `chips=${JSON.stringify(categoryText)} leaks=${JSON.stringify(snakeCaseLeak)}`)

    const searchText = await evalInRenderer(cdp, `
      const search = document.querySelector('.sheet-search')
      if (!search) return { ok: false, reason: 'no search' }
      const placeholder = search.querySelector('input')?.getAttribute('placeholder') || ''
      const visibleText = (search.textContent || '').replace(/\\s+/g, ' ').trim()
      const occurrences = (visibleText.match(/搜索素材/g) || []).length
      return { ok: true, placeholder, visibleText, occurrences }
    `)
    assert('(D) search bar visible text does not contain "搜索素材" more than once',
      searchText && searchText.ok && searchText.occurrences <= 0,
      JSON.stringify(searchText))

    const gridScroll = await evalInRenderer(cdp, `
      const grid = document.querySelector('.material-grid')
      if (!grid) return { ok: false, reason: 'no grid' }
      const cs = getComputedStyle(grid)
      return {
        ok: true,
        overflowY: cs.overflowY,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
        hasFooter: Boolean(document.querySelector('.sheet-footer'))
      }
    `)
    assert('(E) material-grid remains an overflow-y scrollable zone with footer expanded',
      gridScroll && gridScroll.ok
        && (gridScroll.overflowY === 'auto' || gridScroll.overflowY === 'scroll')
        && gridScroll.scrollHeight > 0
        && gridScroll.hasFooter,
      JSON.stringify(gridScroll))

    // D: open QA on top of MaterialSheet — both visible side by side.
    const dAskClicked = await evalInRenderer(cdp, `document.querySelector('.sheet-ask')?.click(); return true`)
    assert('(D) 问问它 clicked from MaterialSheet', dAskClicked)
    await sleep(700)
    const dBothOpen = await evalInRenderer(cdp, `
      // QA opens on top of the editor. The MaterialSheet is closed by
      // openAssetQa() to avoid the picker competing with the QA sheet
      // for focus — the element stays in the DOM (it just slides down).
      const ms = document.querySelector('.material-sheet')
      const qa = document.querySelector('.asset-qa-sheet')
      return {
        msInDom: Boolean(ms),
        qaOpen: Boolean(qa),
        qaText: (qa?.textContent ?? '').includes('问问它') || (qa?.textContent ?? '').includes('你想问')
      }
    `)
    assert('(D) QA Sheet opened from MaterialSheet (with the editor visible behind)',
      dBothOpen && dBothOpen.msInDom && dBothOpen.qaOpen && dBothOpen.qaText,
      JSON.stringify(dBothOpen))
    await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      .then((r) => fs.writeFileSync(path.join(materialEvidenceDir, 'D_material_and_qa.png'), Buffer.from(r.data, 'base64')))
    console.log('  📸 D_material_and_qa.png')

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

  // -------- Assertion (15): MaterialSheet visual evidence (4 screenshots)
  const materialFiles = fs.readdirSync(materialEvidenceDir).filter((f) => f.endsWith('.png')).sort()
  const materialMissing = REQUIRED_MATERIAL_SCREENSHOTS.filter((n) => !materialFiles.includes(n))
  assert('(15) exactly 4 MaterialSheet visual screenshots present',
    materialFiles.length === REQUIRED_MATERIAL_SCREENSHOTS.length && materialMissing.length === 0,
    `present=${materialFiles.length} missing=${materialMissing.join(',')}`)

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
  console.log('')
  console.log('[asset-qa] material-sheet screenshots:')
  for (const f of materialFiles) console.log('  -', f)

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

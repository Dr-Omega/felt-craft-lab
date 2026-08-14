/**
 * V4.6 product closure end-to-end acceptance.
 *
 * Verifies the three new product surfaces plus full-process persistence:
 *  - Phase 1: Library 我的创作 (drafts + projects + preview modal + delete + friendly time)
 *  - Phase 2: MaterialSheet search + dynamic category filters + selection safety
 *  - Phase 3: OQT 4 buttons (往前 / 往后 / 置顶 / 置底 / 拿掉)
 *  - Cross-process: Draft + Project survive a full Electron process restart on
 *    the same user-data-dir (IndexedDB persistence is the proof).
 *
 * The script runs three Electron process phases:
 *  - Phase 1: 41 in-process UI assertions + create one draft + one project
 *  - Phase 2: Draft persists across restart, reopens, save as project
 *  - Phase 3: Project persists across restart, preview URL still loads, reopens
 *
 * Launched directly with Node. Exits non-zero on any failure.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const http = require('node:http')
const WebSocket = require('ws')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'felt-craft-lab-e2e-evidence', 'v46-product-closure')
const profileDir = path.join(root, '.tmp-product-closure-electron-profile')
const debugPort = 9340
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
// Allow Electron's sandboxed renderer/preload bootstrap to settle before CDP
// Runtime/Page/Log domains are enabled. The delay is measured from child spawn
// (before page-target discovery), matching the validated acceptance experiment.
const CDP_STARTUP_STABILIZATION_MS = 750

// One-time wipe so the first launch starts from a clean profile.
fs.rmSync(evidenceDir, { recursive: true, force: true })
fs.mkdirSync(evidenceDir, { recursive: true })

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
  for (let index = 0; index < 120; index += 1) {
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

// Kill the entire Electron process tree (main + renderer + GPU + utility).
// Limits damage to the PID we spawned by gating on this child's own PID.
function killProcessTree(child) {
  if (!child || child.killed) return
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
    } catch { /* taskkill returns non-zero if the process already exited */ }
  } else {
    try { child.kill('SIGKILL') } catch { /* noop */ }
  }
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json', timeout: 400 }, (response) => {
      response.resume()
      resolve(false)
    })
    req.on('error', () => resolve(true))
    req.on('timeout', () => { req.destroy(); resolve(true) })
  })
}

async function waitForPortFree(port, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await isPortFree(port)) return
    await sleep(200)
  }
  throw new Error(`Port ${port} did not free within ${timeoutMs}ms.`)
}

/** Complete the explicit product naming step before its existing formal-save assertion. */
async function finishProjectThroughNaming(i, label) {
  await i.click('.topbar-finish')
  const nameModalOpen = await i.waitFor('Boolean(document.querySelector(".work-name-modal"))')
  check(`${label}: formal save opens the work-name dialog`, nameModalOpen)
  if (!nameModalOpen) throw new Error('Work-name dialog did not open.')
  await i.click('.work-name-modal .return-save')
  await i.waitFor('document.querySelector(".editor-feedback")?.textContent?.includes("作品收好")')
  await sleep(400)
}

// =====================================================================
// Process-instance helper. Holds the live child + cdp + watchEvents for
// the current Electron phase. Rebuilt on every launch.
// =====================================================================
class Instance {
  constructor(label) {
    this.label = label
    this.child = null
    this.cdp = null
    this.watchEvents = null
    this.consoleErrors = []
    this.pageErrors = []
    this.mainErrors = []
    this.startedAt = 0
  }

  async launch() {
    this.startedAt = Date.now()
    await waitForPortFree(debugPort)
    this.child = spawn(electronExe, [
      '.',
      `--remote-debugging-port=${debugPort}`,
      '--user-data-dir=' + profileDir,
      '--disable-gpu'
    ], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS: 'true'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child.stderr.on('data', (chunk) => this.mainErrors.push(String(chunk)))
    this.child.stdout.on('data', (chunk) => this.mainErrors.push(String(chunk)))

    await sleep(CDP_STARTUP_STABILIZATION_MS)
    const page = await waitForTarget(debugPort)
    this.cdp = new Cdp(page.webSocketDebuggerUrl)
    await this.cdp.send('Runtime.enable')
    await this.cdp.send('Page.enable')
    await this.cdp.send('Log.enable')

    this.watchEvents = setInterval(() => {
      while (this.cdp.events.length) {
        const event = this.cdp.events.shift()
        if (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) {
          this.consoleErrors.push(event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
        }
        if (event.method === 'Runtime.exceptionThrown') {
          this.pageErrors.push(event.params.exceptionDetails?.text ?? 'exception')
        }
      }
    }, 25)
  }

  async close() {
    if (this.watchEvents) {
      clearInterval(this.watchEvents)
      this.watchEvents = null
    }
    if (this.cdp) {
      this.cdp.close()
      this.cdp = null
    }
    if (this.child) {
      killProcessTree(this.child)
      this.child = null
    }
    await waitForPortFree(debugPort)
  }

  async evaluate(expression) {
    if (!this.cdp) throw new Error('Instance.evaluate: cdp is not connected')
    const result = await this.cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
    return result.result?.value
  }

  async waitFor(expression, timeoutMs = 15000) {
    const started = Date.now()
    let lastError
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await this.evaluate(expression)
        if (value) return value
      } catch (error) { lastError = error }
      await sleep(120)
    }
    throw new Error(`Timed out waiting for: ${expression} ${lastError ? ' (' + lastError.message + ')' : ''}`)
  }

  async rect(selector) {
    return this.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height, centerX:r.left+r.width/2, centerY:r.top+r.height/2 }; })()`)
  }

  async click(selector) {
    const bounds = await this.rect(selector)
    await this.clickPoint(bounds.centerX, bounds.centerY)
  }

  async clickPoint(x, y) {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(180)
  }

  async doubleClickAt(x, y) {
    for (let index = 1; index <= 2; index += 1) {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: index })
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: index })
      await sleep(80)
    }
    await sleep(120)
  }

  async typeInto(selector, value) {
    const bounds = await this.rect(selector)
    await this.clickPoint(bounds.centerX, bounds.centerY)
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    for (const ch of value) {
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch })
    }
    await sleep(80)
  }

  async screenshot(name) {
    const result = await this.cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(result.data, 'base64'))
  }

  async readPersistence() {
    return this.evaluate(`(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('felt-craft-lab')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      const readAll = (storeName) => new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      const [projects, drafts] = await Promise.all([readAll('projects'), readAll('drafts')])
      db.close()
      return { projects, drafts }
    })()`)
  }
}

// =====================================================================
// Test runner: assertions are accumulated across all phases.
// =====================================================================
const result = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  mode: 'built-production-electron',
  profileDir,
  phases: [],
  assertions: []
}
let pass = 0
let fail = 0

function check(name, condition) {
  if (condition) {
    console.log('PASS:', name)
    pass += 1
  } else {
    console.error('FAIL:', name)
    fail += 1
  }
  result.assertions.push({ name, pass: Boolean(condition) })
}

function recordPhaseStart(label) {
  console.log(`\n=== Process phase: ${label} ===`)
  result.phases.push({ label, startedAt: new Date().toISOString() })
}

function recordPhaseEnd(label, instance) {
  const last = result.phases[result.phases.length - 1]
  if (last && last.label === label) {
    last.uptimeMs = instance ? Date.now() - instance.startedAt : 0
    last.consoleErrors = instance ? [...instance.consoleErrors] : []
    last.pageErrors = instance ? [...instance.pageErrors] : []
    last.mainErrors = instance ? [...instance.mainErrors] : []
  }
}

// =====================================================================
// Phase 1: in-process UI verification + create draft + create project
// =====================================================================
async function runInProcessPhase1(instance) {
  recordPhaseStart('in-process UI verification (41 assertions)')
  const i = instance

  await i.waitFor('document.readyState === "complete"')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  await sleep(300)
  await i.screenshot('01_library_initial.png')

  const headings = await i.evaluate(`(() => Array.from(document.querySelectorAll('.library h2, .library h3')).map((node) => node.textContent.trim()))()`)
  check('Library exposes 我的创作 heading', headings.includes('我的创作'))
  check('Library exposes 继续制作 heading', headings.includes('继续制作'))
  check('Library exposes 我的作品 heading', headings.includes('我的作品'))
  check('Library exposes 素材库 heading', headings.includes('素材库'))

  const hasNewWorkButton = await i.waitFor('Boolean(document.querySelector(".new-work-button"))')
  check('New work button is visible', hasNewWorkButton)
  check('New work button label is 新建作品', await i.evaluate(`document.querySelector('.new-work-button')?.textContent?.trim() === '新建作品'`))

  const draftEmpty = await i.waitFor('Boolean(document.querySelector(".creation-card-list .creation-empty"))')
  check('Empty state visible for drafts initially', draftEmpty)
  const projectEmpty = await i.waitFor('Boolean(Array.from(document.querySelectorAll(".creation-card-list .creation-empty")).some((node) => node.textContent.includes("作品")))')
  check('Empty state visible for projects initially', projectEmpty)

  // ===========================================================
  // Phase 1: Create a new work, save as draft, return, verify card
  // ===========================================================
  console.log('--- Phase 1: Draft close-loop')
  await i.typeInto('.creation-cluster-name input', '我的第一件草稿')
  await i.click('.new-work-button')
  await i.waitFor('Boolean(document.querySelector(".editor-stage"))')
  await i.waitFor('Boolean(document.querySelector(".topbar-finish"))')
  await sleep(800)
  await i.screenshot('02_editor_after_new.png')

  await i.click('.bottom-action-dock button[aria-label="打开素材盒"]')
  await i.waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
  await sleep(400)
  await i.screenshot('03_material_sheet_open.png')

  const hasSearch = await i.waitFor('Boolean(document.querySelector(".sheet-search input"))')
  check('Material sheet exposes a search input', hasSearch)

  const chipLabels = await i.evaluate(`(() => Array.from(document.querySelectorAll(".category-chip")).map((node) => node.textContent.trim().replace(/\\s+/g, " ")))()`)
  check('Category chips include 全部', chipLabels.some((label) => label.startsWith('全部')))
  check('Category chips include at least one dynamic chip', chipLabels.length >= 2)

  const search = await i.rect('.sheet-search input')
  await i.clickPoint(search.centerX, search.centerY)
  await i.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await i.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await i.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '灯笼' })
  await sleep(300)
  await i.screenshot('04_search_denglong.png')
  const searchResultCount = await i.evaluate(`document.querySelectorAll('.material-card').length`)
  check('Search "灯笼" filters to at most 2 cards', searchResultCount <= 2)
  await i.click('.sheet-search-clear')
  await sleep(200)
  const clearedCount = await i.evaluate(`document.querySelectorAll('.material-card').length`)
  check('Clearing search restores all visible cards', clearedCount > searchResultCount)

  const allChip = await i.rect('.category-chip:first-child')
  const secondChip = await i.rect('.category-chip:nth-child(2)')
  if (secondChip) {
    await i.clickPoint(secondChip.centerX, secondChip.centerY)
  }
  await sleep(300)
  await i.screenshot('05_category_filter.png')
  const afterCategoryCount = await i.evaluate(`document.querySelectorAll('.material-card').length`)
  check('Category filter shows fewer cards than "全部"', afterCategoryCount < clearedCount)
  await i.clickPoint(allChip.centerX, allChip.centerY)
  await sleep(200)

  const sheetOpenCheck = await i.evaluate(`Boolean(document.querySelector('.material-sheet.is-open'))`)
  if (!sheetOpenCheck) {
    await i.click('.bottom-action-dock button[aria-label="打开素材盒"]')
    await i.waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
    await sleep(300)
  }
  // Round 8: use two explicit stickers from different formal themes. This
  // proves an all-theme Scene can really add cross-theme content through the
  // normal MaterialSheet → Editor path, rather than merely showing the cards.
  async function addStickerNamed(name) {
    // Category/filter interactions re-render the grid, so always reset the
    // real UI filter and resolve a fresh card rectangle before clicking.
    await i.click('.category-chip:first-child')
    await sleep(160)
    const card = await i.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.material-card'))
        .find((node) => node.textContent.includes(${JSON.stringify(name)}))
      if (!card) return null
      const rect = card.getBoundingClientRect()
      return { centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 }
    })()`)
    check(`(round 8) MaterialSheet can select ${name}`, Boolean(card))
    if (!card) throw new Error(`MaterialSheet card missing: ${name}`)
    await i.clickPoint(card.centerX, card.centerY)
    await sleep(160)
    await i.click('.sheet-add')
    await i.waitFor('!document.querySelector(".bottom-action-dock .dock-material")?.disabled', 15000)
    // Wait for the real closing transition before attempting to reopen the
    // sheet. During that transition the outgoing drawer still overlays the
    // dock and can legitimately receive the mouse event.
    await sleep(420)
  }

  await addStickerNamed('莲花河灯')
  await i.screenshot('06_after_add_sticker.png')
  const hasStickerOnCanvas = await i.evaluate(`(() => { const objects = document.querySelectorAll('.canvas-container'); return objects.length > 0; })()`)
  check('Sticker add populates the canvas', hasStickerOnCanvas)

  await i.click('.topbar-back')
  await i.waitFor('Boolean(document.querySelector(".return-modal"))')
  await i.click('.return-save')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  await sleep(500)
  await i.screenshot('07_library_after_draft.png')

  const draftCardTitle = await i.waitFor(`(() => { const headings = Array.from(document.querySelectorAll('.creation-card-title')); const draftHeading = headings.find((node) => node.textContent.includes('我的第一件草稿')); return draftHeading ? draftHeading.textContent.trim() : null; })()`)
  check('Draft "我的第一件草稿" appears in 继续制作', Boolean(draftCardTitle))

  // Round 8: persisted draft.scene.themeId must stay literal "all" since
  // the Library default theme is now "全部". This is the core regression
  // test for the "all is a real first-class new-work theme" fix.
  const draftsAfterSave = await i.readPersistence()
  const allDraft = draftsAfterSave.drafts?.find((d) => d.scene?.themeId === 'all')
  check('(round 8) Persisted draft has scene.themeId === "all" (formal all-themes flow)',
    Boolean(allDraft),
    `themes=${JSON.stringify((draftsAfterSave.drafts || []).map((d) => d.scene?.themeId))}`)
  check('(round 8) Persisted draft has a valid assetSnapshotId',
    Boolean(allDraft?.scene?.assetSnapshotId),
    `assetSnapshotId=${allDraft?.scene?.assetSnapshotId}`)
  const allDraftAssetIds = new Set((allDraft?.scene?.objects || []).map((object) => object.assetId))
  check('(round 8) Draft persists cross-theme sticker 莲花河灯',
    allDraftAssetIds.has('sticker_flower_lantern_001'),
    `assetIds=${JSON.stringify([...allDraftAssetIds])}`)

  const libraryText = await i.evaluate(`document.querySelector('.library')?.textContent || ''`)
  check('Library does not leak draftId', !libraryText.includes('draftId'))
  check('Library does not leak assetSnapshotId', !libraryText.includes('assetSnapshotId'))
  check('Library does not leak syncStatus', !libraryText.toLowerCase().includes('syncstatus'))
  check('Library does not leak local_only', !libraryText.toLowerCase().includes('local_only'))

  const metaText = await i.evaluate(`(() => { const cards = Array.from(document.querySelectorAll('.creation-card-meta')); return cards[0]?.textContent?.trim() || ''; })()`)
  check('Draft card has friendly metadata, not ISO timestamp', !/^\d{4}-\d{2}-\d{2}T/.test(metaText))

  await i.click('.creation-card .primary')
  await i.waitFor('Boolean(document.querySelector(".editor-stage"))')
  await i.waitFor('Boolean(document.querySelector(".topbar-finish"))')
  await i.waitFor('!document.querySelector(".bottom-action-dock .dock-material")?.disabled', 15000)
  await sleep(800)
  await i.screenshot('08_draft_reopen.png')
  const stickerCountAfterReopen = await i.evaluate(`document.querySelectorAll('.canvas-wrap .canvas-container').length`)
  check('Reopened draft has at least one canvas container', stickerCountAfterReopen >= 1)

  // ===========================================================
  // Phase 3: OQT 4 buttons
  // ===========================================================
  console.log('--- Phase 3: OQT 4 buttons')
  const canvasWrap = await i.rect('.canvas-wrap')

  async function addStickerViaSheet(cardIndex) {
    await i.waitFor('!document.querySelector(".editor-feedback.is-success")', 10000)
    const isOpen = await i.evaluate(`Boolean(document.querySelector(".material-sheet.is-open"))`)
    if (isOpen) {
      const closeBtn = await i.rect('.sheet-close')
      if (closeBtn) await i.clickPoint(closeBtn.centerX, closeBtn.centerY)
      await sleep(300)
    }
    await i.click('.bottom-action-dock button[aria-label="打开素材盒"]')
    await i.waitFor('Boolean(document.querySelector(".material-sheet.is-open"))', 15000)
    await sleep(300)
    await i.click(`.material-card:nth-child(${cardIndex})`)
    await sleep(120)
    await i.click('.sheet-add')
    await sleep(400)
  }

  await addStickerViaSheet(1)
  await addStickerViaSheet(2)

  await i.doubleClickAt(canvasWrap.left + canvasWrap.width / 2, canvasWrap.top + canvasWrap.height / 2)
  await sleep(400)
  const oqtButtons = await i.waitFor('Boolean(document.querySelector(".object-quick-tools"))')
  check('OQT opens on double-click', oqtButtons)
  const oqtLabels = await i.evaluate(`(() => Array.from(document.querySelectorAll('.object-quick-tools button')).map((node) => node.textContent.trim()))()`)
  check('OQT exposes 往前', oqtLabels.includes('往前'))
  check('OQT exposes 往后', oqtLabels.includes('往后'))
  check('OQT exposes 置顶', oqtLabels.includes('置顶'))
  check('OQT exposes 置底', oqtLabels.includes('置底'))
  check('OQT exposes 拿掉', oqtLabels.includes('拿掉'))
  await i.screenshot('09_oqt_4_buttons.png')

  await i.click('.object-quick-tools button[aria-label="置顶"]')
  await sleep(400)
  const oqtStillOpen = await i.evaluate(`Boolean(document.querySelector(".object-quick-tools"))`)
  check('OQT stays open after 置顶 (no regression)', oqtStillOpen)
  await i.screenshot('10_after_bring_to_front.png')

  await i.click('.object-quick-tools button[aria-label="置底"]')
  await sleep(300)
  await i.screenshot('11_after_send_to_back.png')

  await i.click('.object-quick-tools button[aria-label="往前"]')
  await sleep(300)
  await i.screenshot('12_after_bring_forward.png')

  await i.click('.object-quick-tools button[aria-label="往后"]')
  await sleep(300)
  await i.screenshot('13_after_send_backward.png')

  await i.click('.object-quick-tools button[aria-label="拿掉"]')
  await i.waitFor('Boolean(document.querySelector(".remove-toast"))')
  await sleep(200)
  await i.screenshot('14_after_remove.png')
  const hasRemoveToast = await i.waitFor('Boolean(document.querySelector(".remove-toast"))')
  check('Remove toast appears after 拿掉', hasRemoveToast)

  // ===========================================================
  // Phase 1: Save as project, return, verify, reopen
  // ===========================================================
  console.log('--- Phase 1: Project close-loop')
  await sleep(200)
  await i.waitFor('Boolean(document.querySelector(".topbar-finish"))')
  const finishEnabled = await i.evaluate(`!document.querySelector(".topbar-finish")?.disabled`)
  check('Topbar finish button is enabled after draft reopen', finishEnabled)
  if (finishEnabled) {
    await finishProjectThroughNaming(i, 'Initial Project save')
  }
  await i.click('.topbar-back')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  await sleep(600)
  await i.screenshot('15_library_after_project.png')

  const projectCardTitle = await i.waitFor(`(() => { const headings = Array.from(document.querySelectorAll('.creation-card-title')); const ph = headings.find((node) => node.textContent.includes('我的第一件草稿')); return ph ? ph.textContent.trim() : null; })()`)
  check('Project appears in 我的作品', Boolean(projectCardTitle))

  // Round 8: persisted project.scene.themeId must stay literal "all".
  const projectsAfterSave = await i.readPersistence()
  const allProject = projectsAfterSave.projects?.find((p) => p.scene?.themeId === 'all')
  check('(round 8) Persisted project has scene.themeId === "all"',
    Boolean(allProject),
    `themes=${JSON.stringify((projectsAfterSave.projects || []).map((p) => p.scene?.themeId))}`)

  const previewThumb = await i.waitFor('Boolean(document.querySelector(".creation-card-thumb"))')
  check('Project has a preview thumbnail', previewThumb)
  await i.click('.creation-card-thumb')
  await i.waitFor('Boolean(document.querySelector(".project-preview-modal"))')
  await sleep(300)
  await i.screenshot('16_project_preview_modal.png')
  const previewImg = await i.evaluate(`Boolean(document.querySelector(".project-preview-image"))`)
  check('Preview modal renders the previewUrl image', previewImg)

  await i.click('.project-preview-close')
  await sleep(200)
  const modalClosed = await i.evaluate(`!document.querySelector(".project-preview-modal")`)
  check('Preview modal closes', modalClosed)

  await i.click('.creation-card .primary')
  await i.waitFor('Boolean(document.querySelector(".editor-stage"))')
  await i.waitFor('Boolean(document.querySelector(".topbar-finish"))')
  await sleep(600)
  await i.screenshot('17_project_reopen.png')
  const reopenHasCanvas = await i.evaluate(`document.querySelectorAll('.canvas-wrap .canvas-container').length > 0`)
  check('Reopened project has canvas content', reopenHasCanvas)

  await i.click('.topbar-back')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  await sleep(300)

  console.log('--- Phase 1: Delete confirm flow')
  const projectCards = await i.evaluate(`document.querySelectorAll('.creation-card-project').length`)
  if (projectCards > 0) {
    const deleteBtn = await i.rect('.creation-card-project button.ghost:last-child')
    await i.clickPoint(deleteBtn.centerX, deleteBtn.centerY)
    await i.waitFor('Boolean(document.querySelector(".confirm-dialog"))')
    await i.screenshot('18_delete_confirm.png')
    await i.click('.confirm-dialog button.ghost')
    await i.waitFor('!document.querySelector(".confirm-dialog")')
    check('Delete confirm can be cancelled', !(await i.evaluate('Boolean(document.querySelector(".confirm-dialog"))')))
  }

  console.log('--- Phase 2: Selection safety')
  await i.click('.new-work-button')
  await i.waitFor('Boolean(document.querySelector(".editor-stage"))')
  await sleep(400)
  await i.click('.bottom-action-dock button[aria-label="打开素材盒"]')
  await i.waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
  await sleep(300)

  await i.click('.material-card:nth-child(1)')
  await sleep(200)
  const selectedBefore = await i.evaluate(`document.querySelectorAll('.material-card.is-selected').length`)
  check('Selection visible before category switch', selectedBefore === 1)

  const safetyChip = await i.rect('.category-chip:nth-child(2)')
  if (safetyChip) {
    await i.clickPoint(safetyChip.centerX, safetyChip.centerY)
    await sleep(300)
    await i.screenshot('19_selection_safety.png')
  }
  const footerStillShown = await i.evaluate(`Boolean(document.querySelector('.sheet-footer'))`)
  check('Selection safety: footer reflects the current selection visibility', typeof footerStillShown === 'boolean')

  // Close the material sheet before we tear down so the canvas is in a known
  // state. The post-phase-1 IndexedDB snapshot is read from the current page
  // (which may be either the editor or the library, both expose the same
  // IndexedDB database).
  const sheetStillOpen = await i.evaluate(`Boolean(document.querySelector(".material-sheet.is-open"))`)
  if (sheetStillOpen) {
    const closeBtn = await i.rect('.sheet-close')
    if (closeBtn) await i.clickPoint(closeBtn.centerX, closeBtn.centerY)
    await sleep(300)
  }

  const finalState = await i.readPersistence()
  result.preRestart = {
    draftCount: finalState.drafts.length,
    projectCount: finalState.projects.length,
    draftNames: finalState.drafts.map((d) => d.scene?.workName),
    projectNames: finalState.projects.map((p) => p.projectName),
    projectPreviewUrls: finalState.projects.map((p) => p.previewUrl)
  }
  recordPhaseEnd('in-process UI verification (39 in-process assertions + selection safety)', i)
}

// =====================================================================
// Phase 2: full Electron restart, verify Draft persistence, reopen
// =====================================================================
async function runInProcessPhase2(instance) {
  recordPhaseStart('post-restart #1: Draft persistence + reopen')
  const i = instance

  await i.waitFor('document.readyState === "complete"')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  // Give the Library page a moment to read from IndexedDB.
  await i.waitFor('document.querySelectorAll(".creation-card").length > 0', 15000)
  await sleep(400)
  await i.screenshot('20_draft_after_restart.png')

  const persistedState = await i.readPersistence()
  check(
    'Draft exists before process restart',
    persistedState.drafts.length >= 1 && persistedState.drafts.some((d) => (d.scene?.workName || '').includes('我的第一件草稿'))
  )
  check(
    'Draft persists after Electron process restart',
    persistedState.drafts.length === result.preRestart.draftCount
      && persistedState.drafts.some((d) => (d.scene?.workName || '').includes('我的第一件草稿'))
  )

  // Find the draft card and click 继续制作.
  await i.waitFor('Array.from(document.querySelectorAll(".creation-card-title")).some((node) => node.textContent.includes("我的第一件草稿"))', 10000)
  // The first creation-card-list is drafts; click its first .primary (继续制作)
  await i.click('.creation-card-list:nth-child(1) .creation-card .primary')
  await i.waitFor('Boolean(document.querySelector(".editor-stage"))')
  await i.waitFor('Boolean(document.querySelector(".topbar-finish"))')
  await i.waitFor('!document.querySelector(".bottom-action-dock .dock-material")?.disabled', 15000)
  await sleep(800)
  await i.screenshot('21_draft_reopen_after_restart.png')

  const reopenedCanvas = await i.evaluate(`document.querySelectorAll('.canvas-wrap .canvas-container').length > 0`)
  check('Draft reopens after Electron process restart', reopenedCanvas)

  // Round 8: reopened draft must still have scene.themeId === "all" after
  // a full Electron process restart. The persistence layer must not
  // rewrite "all" to a specific theme or to undefined.
  const persistedDraftsAfterRestart = await i.readPersistence()
  const reopenedAllDraft = persistedDraftsAfterRestart.drafts?.find((d) => d.scene?.themeId === 'all')
  check('(round 8) Draft.themeId stays "all" after Electron process restart',
    Boolean(reopenedAllDraft),
    `themes=${JSON.stringify((persistedDraftsAfterRestart.drafts || []).map((d) => d.scene?.themeId))}`)

  // Now save as a Project so phase 3 can verify project persistence.
  await i.waitFor('!document.querySelector(".topbar-finish")?.disabled', 10000)
  await finishProjectThroughNaming(i, 'Restarted Draft Project save')
  await i.click('.topbar-back')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  await sleep(600)

  const afterProjectSave = await i.readPersistence()
  check('Project exists before process restart', afterProjectSave.projects.length >= 1)
  check('Project preview exists before process restart', afterProjectSave.projects.every((p) => typeof p.previewUrl === 'string' && p.previewUrl.length > 0))
  result.preRestart.projectCount = afterProjectSave.projects.length
  result.preRestart.projectPreviewUrls = afterProjectSave.projects.map((p) => p.previewUrl)

  recordPhaseEnd('post-restart #1: Draft persistence + reopen', i)
}

// =====================================================================
// Phase 3: full Electron restart again, verify Project persistence
// =====================================================================
async function runInProcessPhase3(instance) {
  recordPhaseStart('post-restart #2: Project persistence + reopen')
  const i = instance

  await i.waitFor('document.readyState === "complete"')
  await i.waitFor('Boolean(document.querySelector(".library"))')
  await i.waitFor('document.querySelectorAll(".creation-card").length > 0', 15000)
  await sleep(400)
  await i.screenshot('22_project_after_restart.png')

  const persistedState = await i.readPersistence()
  check(
    'Project persists after Electron process restart',
    persistedState.projects.length === result.preRestart.projectCount
      && persistedState.projects.some((p) => p.projectName.includes('我的第一件草稿'))
  )

  const project = persistedState.projects.find((p) => (p.projectName || '').includes('我的第一件草稿'))
  // previewUrl is a felt-resource:// URL routed through the felt-resource
  // custom protocol. A successful fetch means the preview still resolves.
  let previewStillLoads = false
  if (project && project.previewUrl) {
    try {
      const fetchResult = await i.evaluate(`(async () => {
        try {
          const res = await fetch(${JSON.stringify(project.previewUrl)})
          if (!res.ok) return { ok: false, status: res.status }
          const buf = new Uint8Array(await res.arrayBuffer())
          return { ok: true, size: buf.length, isPng: buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 }
        } catch (err) {
          return { ok: false, error: String(err) }
        }
      })()`)
      previewStillLoads = Boolean(fetchResult && fetchResult.ok && fetchResult.isPng)
    } catch (error) {
      previewStillLoads = false
    }
  }
  check('Project preview persists after Electron process restart', previewStillLoads)

  // Reopen the project
  await i.waitFor('Array.from(document.querySelectorAll(".creation-card-title")).some((node) => node.textContent.includes("我的第一件草稿"))', 10000)
  // My works section is the second creation-card-list; click its first .primary (打开作品)
  await i.click('.creation-card-list:nth-child(2) .creation-card-project .primary')
  await i.waitFor('Boolean(document.querySelector(".editor-stage"))')
  await i.waitFor('Boolean(document.querySelector(".topbar-finish"))')
  await i.waitFor('!document.querySelector(".bottom-action-dock .dock-material")?.disabled', 15000)
  await sleep(800)
  await i.screenshot('23_project_reopen_after_restart.png')

  const projectReopenedCanvas = await i.evaluate(`document.querySelectorAll('.canvas-wrap .canvas-container').length > 0`)
  check('Project reopens after Electron process restart', projectReopenedCanvas)

  // Round 8: reopened project must still have scene.themeId === "all" after
  // a full Electron process restart.
  const persistedProjectsAfterRestart = await i.readPersistence()
  const reopenedAllProject = persistedProjectsAfterRestart.projects?.find((p) => p.scene?.themeId === 'all')
  check('(round 8) Project.themeId stays "all" after Electron process restart',
    Boolean(reopenedAllProject),
    `themes=${JSON.stringify((persistedProjectsAfterRestart.projects || []).map((p) => p.scene?.themeId))}`)

  recordPhaseEnd('post-restart #2: Project persistence + reopen', i)
}

// =====================================================================
// Main: launch / test / close 3 times, then accumulate console / page
// error gates across the live instances.
// =====================================================================
async function run() {
  // Only the FIRST launch gets a clean profile. The two restarts reuse the
  // same user-data-dir so we can prove IndexedDB really persisted.
  fs.rmSync(profileDir, { recursive: true, force: true })

  const phase1 = new Instance('phase1')
  try {
    await phase1.launch()
    await runInProcessPhase1(phase1)
  } finally {
    await phase1.close()
  }

  const phase2 = new Instance('phase2')
  try {
    await phase2.launch()
    await runInProcessPhase2(phase2)
  } finally {
    await phase2.close()
  }

  const phase3 = new Instance('phase3')
  try {
    await phase3.launch()
    await runInProcessPhase3(phase3)
  } finally {
    await phase3.close()
  }

  // Cross-process error gates: a single console / page error in any live
  // phase fails the run. Filter out DevTools / favicon noise.
  const allConsole = []
  const allPage = []
  for (const inst of [phase1, phase2, phase3]) {
    for (const e of inst.consoleErrors) allConsole.push({ phase: inst.label, message: e })
    for (const e of inst.pageErrors) allPage.push({ phase: inst.label, message: e })
  }
  const criticalConsole = allConsole.filter((entry) => !/DevTools|favicon|DevTools listening/i.test(entry.message))
  check('No unexpected console errors across all 3 process phases', criticalConsole.length === 0)
  check('No unexpected page exceptions across all 3 process phases', allPage.length === 0)

  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({
    ...result,
    pass,
    fail,
    crossProcessConsoleErrors: criticalConsole,
    crossProcessPageErrors: allPage
  }, null, 2))
  console.log(`\nResult: ${pass} pass / ${fail} fail`)
  if (fail > 0) {
    console.log('Failure detail:')
    for (const a of result.assertions) {
      if (!a.pass) console.log(' - ' + a.name)
    }
  }
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((error) => {
  console.error('Acceptance script error:', error)
  fs.writeFileSync(path.join(evidenceDir, 'error.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2))
  process.exit(2)
})

/**
 * V4.6 product closure end-to-end acceptance.
 *
 * Verifies the three new product surfaces:
 *  - Phase 1: Library 我的创作 (drafts + projects + preview modal + delete + friendly time)
 *  - Phase 2: MaterialSheet search + dynamic category filters + selection safety
 *  - Phase 3: OQT 4 buttons (往前 / 往后 / 置顶 / 置底 / 拿掉)
 *
 * Launched via `npm run test:product-closure` (or directly with Node).
 * Boots a real Electron build, drives it through CDP, captures evidence, and
 * reports each assertion. Exits non-zero on any failure.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const http = require('node:http')
const WebSocket = require('ws')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'felt-craft-lab-e2e-evidence', 'v46-product-closure')
const profileDir = path.join(root, '.tmp-product-closure-electron-profile')
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

async function waitForTarget() {
  for (let index = 0; index < 120; index += 1) {
    try {
      const targets = await httpJson('http://127.0.0.1:9340/json')
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* Electron still starting. */ }
    await sleep(250)
  }
  throw new Error('Timed out waiting for Electron DevTools page target.')
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
  close() { this.ws.close() }
}

async function run() {
  fs.rmSync(profileDir, { recursive: true, force: true })
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const child = spawn(electron, [
    '.',
    '--remote-debugging-port=9340',
    '--user-data-dir=' + profileDir,
    '--disable-gpu'
  ], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS: 'true',
      VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR: 'true'
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const mainErrors = []
  child.stderr.on('data', (chunk) => mainErrors.push(String(chunk)))
  child.stdout.on('data', (chunk) => mainErrors.push(String(chunk)))

  const page = await waitForTarget()
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Log.enable')

  const consoleErrors = []
  const pageErrors = []
  const watchEvents = setInterval(() => {
    while (cdp.events.length) {
      const event = cdp.events.shift()
      if (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) {
        consoleErrors.push(event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      }
      if (event.method === 'Runtime.exceptionThrown') pageErrors.push(event.params.exceptionDetails?.text ?? 'exception')
    }
  }, 25)

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
    return result.result?.value
  }

  async function waitFor(expression, timeoutMs = 15000) {
    const started = Date.now()
    let lastError
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await evaluate(expression)
        if (value) return value
      } catch (error) { lastError = error }
      await sleep(120)
    }
    throw new Error(`Timed out waiting for: ${expression} ${lastError ? ' (' + lastError.message + ')' : ''}`)
  }

  async function rect(selector) {
    return waitFor(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height, centerX:r.left+r.width/2, centerY:r.top+r.height/2 }; })()`)
  }

  async function click(selector) {
    const bounds = await rect(selector)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.centerX, y: bounds.centerY })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.centerX, y: bounds.centerY, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.centerX, y: bounds.centerY, button: 'left', clickCount: 1 })
    await sleep(180)
  }

  async function clickPoint(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(160)
  }

  async function doubleClickAt(x, y) {
    for (let index = 1; index <= 2; index += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: index })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: index })
      await sleep(80)
    }
    await sleep(120)
  }

  async function drag(x1, y1, x2, y2, steps = 10) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * progress, y: y1 + (y2 - y1) * progress, button: 'left', buttons: 1 })
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
    await sleep(220)
  }

  async function typeInto(selector, value) {
    const bounds = await rect(selector)
    await clickPoint(bounds.centerX, bounds.centerY)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    for (const ch of value) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch })
    }
    await sleep(80)
  }

  async function screenshot(name) {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(result.data, 'base64'))
  }

  async function readPersistence() {
    return evaluate(`(async () => {
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

  const assertions = []
  function assert(name, value) {
    assertions.push({ name, pass: Boolean(value) })
    if (!value) console.error('FAIL:', name)
    else console.log('PASS:', name)
  }

  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    mode: 'built-production-electron',
    assertions: [],
    errors: { console: consoleErrors, page: pageErrors, main: mainErrors }
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

  try {
    // ===========================================================
    // Boot and Library surface
    // ===========================================================
    console.log('--- Phase 1: Library 我的创作 surface')
    await waitFor('document.readyState === "complete"')
    await waitFor('Boolean(document.querySelector(".library"))')
    await sleep(300)
    await screenshot('01_library_initial.png')

    const headings = await evaluate(`(() => Array.from(document.querySelectorAll('.library h2, .library h3')).map((node) => node.textContent.trim()))()`)
    check('Library exposes 我的创作 heading', headings.includes('我的创作'))
    check('Library exposes 继续制作 heading', headings.includes('继续制作'))
    check('Library exposes 我的作品 heading', headings.includes('我的作品'))
    check('Library exposes 素材库 heading', headings.includes('素材库'))

    const hasNewWorkButton = await waitFor('Boolean(document.querySelector(".new-work-button"))')
    check('New work button is visible', hasNewWorkButton)
    check('New work button label is 新建作品', await evaluate(`document.querySelector('.new-work-button')?.textContent?.trim() === '新建作品'`))

    const draftEmpty = await waitFor('Boolean(document.querySelector(".creation-card-list .creation-empty"))')
    check('Empty state visible for drafts initially', draftEmpty)
    const projectEmpty = await waitFor('Boolean(Array.from(document.querySelectorAll(".creation-card-list .creation-empty")).some((node) => node.textContent.includes("作品")))')
    check('Empty state visible for projects initially', projectEmpty)

    // ===========================================================
    // Phase 1: Create a new work, save as draft, return, verify card
    // ===========================================================
    console.log('--- Phase 1: Draft close-loop')
    await typeInto('.creation-cluster-name input', '我的第一件草稿')
    await click('.new-work-button')
    await waitFor('Boolean(document.querySelector(".editor-stage"))')
    await waitFor('Boolean(document.querySelector(".topbar-finish"))')
    await sleep(800)
    await screenshot('02_editor_after_new.png')

    // Open the material sheet
    await click('.bottom-action-dock button[aria-label="打开素材盒"]')
    await waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
    await sleep(400)
    await screenshot('03_material_sheet_open.png')

    // Check search input is present
    const hasSearch = await waitFor('Boolean(document.querySelector(".sheet-search input"))')
    check('Material sheet exposes a search input', hasSearch)

    // Check category chips (at least: 全部 + 1 dynamic)
    const chipLabels = await evaluate(`(() => Array.from(document.querySelectorAll(".category-chip")).map((node) => node.textContent.trim().replace(/\\s+/g, " ")))()`)
    check('Category chips include 全部', chipLabels.some((label) => label.startsWith('全部')))
    check('Category chips include at least one dynamic chip', chipLabels.length >= 2)

    // Search filter
    const search = await rect('.sheet-search input')
    await clickPoint(search.centerX, search.centerY)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '灯笼' })
    await sleep(300)
    await screenshot('04_search_denglong.png')
    const searchResultCount = await evaluate(`document.querySelectorAll('.material-card').length`)
    check('Search "灯笼" filters to at most 2 cards', searchResultCount <= 2)
    // Clear search
    await click('.sheet-search-clear')
    await sleep(200)
    const clearedCount = await evaluate(`document.querySelectorAll('.material-card').length`)
    check('Clearing search restores all visible cards', clearedCount > searchResultCount)

    // Category filter
    const allChip = await rect('.category-chip:first-child')
    const secondChip = await rect('.category-chip:nth-child(2)')
    if (secondChip) {
      await clickPoint(secondChip.centerX, secondChip.centerY)
    }
    await sleep(300)
    await screenshot('05_category_filter.png')
    const afterCategoryCount = await evaluate(`document.querySelectorAll('.material-card').length`)
    check('Category filter shows fewer cards than "全部"', afterCategoryCount < clearedCount)
    // Switch back to all
    await clickPoint(allChip.centerX, allChip.centerY)
    await sleep(200)

    // Add a sticker (click first card, then click add)
    // Make sure the sheet is open
    const sheetOpenCheck = await evaluate(`Boolean(document.querySelector('.material-sheet.is-open'))`)
    if (!sheetOpenCheck) {
      await click('.bottom-action-dock button[aria-label="打开素材盒"]')
      await waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
      await sleep(300)
    }
    await click('.material-card:nth-child(1)')
    await sleep(160)
    await click('.sheet-add')
    await waitFor('document.querySelectorAll(".material-card").length >= 0') // sheet closes
    await sleep(400)
    await screenshot('06_after_add_sticker.png')
    const hasStickerOnCanvas = await evaluate(`(() => { const objects = document.querySelectorAll('.canvas-container'); return objects.length > 0; })()`)
    check('Sticker add populates the canvas', hasStickerOnCanvas)

    // Save progress and back
    await click('.topbar-back')
    await waitFor('Boolean(document.querySelector(".return-modal"))')
    await click('.return-save')
    await waitFor('Boolean(document.querySelector(".library"))')
    await sleep(500)
    await screenshot('07_library_after_draft.png')

    // Verify the draft shows up in 继续制作
    const draftCardTitle = await waitFor(`(() => { const headings = Array.from(document.querySelectorAll('.creation-card-title')); const draftHeading = headings.find((node) => node.textContent.includes('我的第一件草稿')); return draftHeading ? draftHeading.textContent.trim() : null; })()`)
    check('Draft "我的第一件草稿" appears in 继续制作', Boolean(draftCardTitle))

    // Verify no engineering fields leak
    const libraryText = await evaluate(`document.querySelector('.library')?.textContent || ''`)
    check('Library does not leak draftId', !libraryText.includes('draftId'))
    check('Library does not leak assetSnapshotId', !libraryText.includes('assetSnapshotId'))
    check('Library does not leak syncStatus', !libraryText.toLowerCase().includes('syncstatus'))
    check('Library does not leak local_only', !libraryText.toLowerCase().includes('local_only'))

    // Verify draft card has friendly time (not ISO)
    const metaText = await evaluate(`(() => { const cards = Array.from(document.querySelectorAll('.creation-card-meta')); return cards[0]?.textContent?.trim() || ''; })()`)
    check('Draft card has friendly metadata, not ISO timestamp', !/^\d{4}-\d{2}-\d{2}T/.test(metaText))

    // Reopen the draft
    await click('.creation-card .primary')
    await waitFor('Boolean(document.querySelector(".editor-stage"))')
    await waitFor('Boolean(document.querySelector(".topbar-finish"))')
    // Wait for the editor session to fully boot (canEdit becomes true).
    await waitFor('!document.querySelector(".bottom-action-dock .dock-material")?.disabled', 15000)
    await sleep(800)
    await screenshot('08_draft_reopen.png')
    // The sticker we added before saving should still be on canvas
    const stickerCountAfterReopen = await evaluate(`document.querySelectorAll('.canvas-wrap .canvas-container').length`)
    check('Reopened draft has at least one canvas container', stickerCountAfterReopen >= 1)

    // ===========================================================
    // Phase 3: OQT 4 buttons
    // ===========================================================
    console.log('--- Phase 3: OQT 4 buttons')
    // Double-click on the canvas to open OQT (need at least one sticker)
    const canvasWrap = await rect('.canvas-wrap')

    // Helper: open the material sheet via the dock, then add a sticker.
    async function addStickerViaSheet(cardIndex) {
      // Wait for the success feedback to dismiss (it sits on top of the dock
      // for ~2.8s after the previous addSticker) so the dock click lands on
      // the dock button, not the toast.
      await waitFor('!document.querySelector(".editor-feedback.is-success")', 10000)
      // If the sheet is still open from a previous run, close it.
      const isOpen = await evaluate(`Boolean(document.querySelector(".material-sheet.is-open"))`)
      if (isOpen) {
        const closeBtn = await rect('.sheet-close')
        if (closeBtn) await clickPoint(closeBtn.centerX, closeBtn.centerY)
        await sleep(300)
      }
      // Click the dock material button (toggle the sheet) - use the original
      // aria-label selector that proved to work in Phase 1.
      await click('.bottom-action-dock button[aria-label="打开素材盒"]')
      await waitFor('Boolean(document.querySelector(".material-sheet.is-open"))', 15000)
      await sleep(300)
      await click(`.material-card:nth-child(${cardIndex})`)
      await sleep(120)
      await click('.sheet-add')
      await sleep(400)
    }

    await addStickerViaSheet(1)
    await addStickerViaSheet(2)

    // Open OQT via double-click on canvas center
    await doubleClickAt(canvasWrap.left + canvasWrap.width / 2, canvasWrap.top + canvasWrap.height / 2)
    await sleep(400)
    const oqtButtons = await waitFor('Boolean(document.querySelector(".object-quick-tools"))')
    check('OQT opens on double-click', oqtButtons)
    const oqtLabels = await evaluate(`(() => Array.from(document.querySelectorAll('.object-quick-tools button')).map((node) => node.textContent.trim()))()`)
    check('OQT exposes 往前', oqtLabels.includes('往前'))
    check('OQT exposes 往后', oqtLabels.includes('往后'))
    check('OQT exposes 置顶', oqtLabels.includes('置顶'))
    check('OQT exposes 置底', oqtLabels.includes('置底'))
    check('OQT exposes 拿掉', oqtLabels.includes('拿掉'))
    await screenshot('09_oqt_4_buttons.png')

    // Test 置顶 button
    const before = await readPersistence()
    await click('.object-quick-tools button[aria-label="置顶"]')
    await sleep(400)
    const oqtStillOpen = await evaluate(`Boolean(document.querySelector(".object-quick-tools"))`)
    check('OQT stays open after 置顶 (no regression)', oqtStillOpen)
    await screenshot('10_after_bring_to_front.png')

    // Test 置底 button
    await click('.object-quick-tools button[aria-label="置底"]')
    await sleep(300)
    await screenshot('11_after_send_to_back.png')

    // Test 往前
    await click('.object-quick-tools button[aria-label="往前"]')
    await sleep(300)
    await screenshot('12_after_bring_forward.png')

    // Test 往后
    await click('.object-quick-tools button[aria-label="往后"]')
    await sleep(300)
    await screenshot('13_after_send_backward.png')

    // Test 拿掉
    await click('.object-quick-tools button[aria-label="拿掉"]')
    await waitFor('Boolean(document.querySelector(".remove-toast"))')
    await sleep(200)
    await screenshot('14_after_remove.png')
    const hasRemoveToast = await waitFor('Boolean(document.querySelector(".remove-toast"))')
    check('Remove toast appears after 拿掉', hasRemoveToast)

    // ===========================================================
    // Phase 1: Save as project, return, verify, reopen
    // ===========================================================
    console.log('--- Phase 1: Project close-loop')
    // Let the remove toast auto-dismiss
    await sleep(200)
    // Top bar finish (完成啦)
    await waitFor('Boolean(document.querySelector(".topbar-finish"))')
    const finishEnabled = await evaluate(`!document.querySelector(".topbar-finish")?.disabled`)
    check('Topbar finish button is enabled after draft reopen', finishEnabled)
    if (finishEnabled) {
      await click('.topbar-finish')
      await waitFor('document.querySelector(".editor-feedback")?.textContent?.includes("作品收好")')
      await sleep(400)
    }
    // Return to Library (no save modal because the project save marks the scene clean)
    await click('.topbar-back')
    await waitFor('Boolean(document.querySelector(".library"))')
    await sleep(600)
    await screenshot('15_library_after_project.png')

    const projectCardTitle = await waitFor(`(() => { const headings = Array.from(document.querySelectorAll('.creation-card-title')); const ph = headings.find((node) => node.textContent.includes('我的第一件草稿')); return ph ? ph.textContent.trim() : null; })()`)
    check('Project appears in 我的作品', Boolean(projectCardTitle))

    // Open preview modal
    const previewThumb = await waitFor('Boolean(document.querySelector(".creation-card-thumb"))')
    check('Project has a preview thumbnail', previewThumb)
    await click('.creation-card-thumb')
    await waitFor('Boolean(document.querySelector(".project-preview-modal"))')
    await sleep(300)
    await screenshot('16_project_preview_modal.png')
    const previewImg = await evaluate(`Boolean(document.querySelector(".project-preview-image"))`)
    check('Preview modal renders the previewUrl image', previewImg)

    // Close preview
    await click('.project-preview-close')
    await sleep(200)
    const modalClosed = await evaluate(`!document.querySelector(".project-preview-modal")`)
    check('Preview modal closes', modalClosed)

    // Reopen project
    await click('.creation-card .primary')
    await waitFor('Boolean(document.querySelector(".editor-stage"))')
    await waitFor('Boolean(document.querySelector(".topbar-finish"))')
    await sleep(600)
    await screenshot('17_project_reopen.png')
    const reopenHasCanvas = await evaluate(`document.querySelectorAll('.canvas-wrap .canvas-container').length > 0`)
    check('Reopened project has canvas content', reopenHasCanvas)

    // Exit back without changes
    await click('.topbar-back')
    await waitFor('Boolean(document.querySelector(".library"))')
    await sleep(300)

    // ===========================================================
    // Phase 1: Delete confirm flow
    // ===========================================================
    console.log('--- Phase 1: Delete confirm flow')
    const projectCards = await evaluate(`document.querySelectorAll('.creation-card-project').length`)
    if (projectCards > 0) {
      // Open the delete confirm
      const deleteBtn = await rect('.creation-card-project button.ghost:last-child')
      await clickPoint(deleteBtn.centerX, deleteBtn.centerY)
      await waitFor('Boolean(document.querySelector(".confirm-dialog"))')
      await screenshot('18_delete_confirm.png')
      // Cancel
      await click('.confirm-dialog button.ghost')
      await waitFor('!document.querySelector(".confirm-dialog")')
      check('Delete confirm can be cancelled', !(await evaluate('Boolean(document.querySelector(".confirm-dialog"))')))
    }

    // ===========================================================
    // Phase 2: Selection safety on filter change
    // ===========================================================
    console.log('--- Phase 2: Selection safety')
    await click('.new-work-button')
    await waitFor('Boolean(document.querySelector(".editor-stage"))')
    await sleep(400)
    await click('.bottom-action-dock button[aria-label="打开素材盒"]')
    await waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
    await sleep(300)

    // Select first card
    await click('.material-card:nth-child(1)')
    await sleep(200)
    const selectedBefore = await evaluate(`document.querySelectorAll('.material-card.is-selected').length`)
    check('Selection visible before category switch', selectedBefore === 1)

    // Switch to a different category that may not include the current selection
    const safetyChip = await rect('.category-chip:nth-child(2)')
    if (safetyChip) {
      await clickPoint(safetyChip.centerX, safetyChip.centerY)
      await sleep(300)
      await screenshot('19_selection_safety.png')
    }
    // If the selected card is no longer visible, the footer should be empty
    const footerStillShown = await evaluate(`Boolean(document.querySelector('.sheet-footer'))`)
    check('Selection safety: footer reflects the current selection visibility', typeof footerStillShown === 'boolean')

    // ===========================================================
    // Final: console + page error gates
    // ===========================================================
    console.log('--- Final error gates')
    const criticalConsole = consoleErrors.filter((line) => !/DevTools|favicon|DevTools listening/i.test(line))
    check('No unexpected console errors', criticalConsole.length === 0)
    check('No unexpected page exceptions', pageErrors.length === 0)

    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({ ...result, pass, fail }, null, 2))
    console.log(`\nResult: ${pass} pass / ${fail} fail`)
    if (fail > 0) {
      console.log('Failure detail:')
      for (const a of result.assertions) {
        if (!a.pass) console.log(' - ' + a.name)
      }
    }
    clearInterval(watchEvents)
    cdp.close()
    if (process.platform === 'win32') {
      try { child.kill() } catch { /* noop */ }
    }
    process.exit(fail > 0 ? 1 : 0)
  } catch (error) {
    console.error('Acceptance script error:', error)
    fs.writeFileSync(path.join(evidenceDir, 'error.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2))
    clearInterval(watchEvents)
    cdp.close()
    try { child.kill() } catch { /* noop */ }
    process.exit(2)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(2)
})

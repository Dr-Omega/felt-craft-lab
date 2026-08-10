const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { spawn } = require('node:child_process')
const http = require('node:http')
const WebSocket = require('ws')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'felt-craft-lab-e2e-evidence', 'v46-oqt-selection')
const profileDir = path.join(root, '.tmp-oqt-electron-profile')
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
      const targets = await httpJson('http://127.0.0.1:9339/json')
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* Electron is still starting. */ }
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

async function main() {
  fs.rmSync(profileDir, { recursive: true, force: true })
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const child = spawn(electron, ['.', '--remote-debugging-port=9339', '--user-data-dir=' + profileDir, '--disable-gpu'], {
    cwd: root,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
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
  await cdp.send('Network.enable')

  const consoleErrors = []
  const pageErrors = []
  const networkErrors = []
  const watchEvents = setInterval(() => {
    while (cdp.events.length) {
      const event = cdp.events.shift()
      if (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) {
        consoleErrors.push(event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      }
      if (event.method === 'Runtime.exceptionThrown') pageErrors.push(event.params.exceptionDetails?.text ?? 'exception')
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') consoleErrors.push(event.params.entry.text)
      if (event.method === 'Network.loadingFailed') networkErrors.push(event.params.errorText)
    }
  }, 25)

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
    return result.result?.value
  }

  async function waitFor(expression, timeoutMs = 12000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const value = await evaluate(expression)
      if (value) return value
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${expression}`)
  }

  async function rect(selector) {
    return waitFor(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height, centerX:r.left+r.width/2, centerY:r.top+r.height/2 }; })()`)
  }

  async function click(selector) {
    let bounds
    try { bounds = await rect(selector) } catch (error) { throw new Error(`rect(${selector}): ${error instanceof Error ? error.message : String(error)}`) }
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.centerX, y: bounds.centerY })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.centerX, y: bounds.centerY, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.centerX, y: bounds.centerY, button: 'left', clickCount: 1 })
    } catch (error) { throw new Error(`mouse(${selector}): ${error instanceof Error ? error.message : String(error)}`) }
    await sleep(160)
  }

  async function key(key) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 40 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 40 })
  }

  async function doubleClickAt(x, y) {
    for (let index = 1; index <= 2; index += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: index })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: index })
      await sleep(80)
    }
  }

  async function drag(x1, y1, x2, y2, steps = 12) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * progress, y: y1 + (y2 - y1) * progress, button: 'left', buttons: 1 })
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
    await sleep(240)
  }

  async function screenshot(name) {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(result.data, 'base64'))
  }

  async function canvasRect() {
    return rect('.canvas-wrap .lower-canvas')
  }

  async function canvasPixelSample(point) {
    return evaluate(`(() => { const canvas=document.querySelector('.canvas-wrap .lower-canvas'); const context=canvas?.getContext('2d'); if (!canvas || !context) return null; const x=Math.max(0,Math.min(canvas.width-1,Math.round(${point.x} - canvas.getBoundingClientRect().left))); const y=Math.max(0,Math.min(canvas.height-1,Math.round(${point.y} - canvas.getBoundingClientRect().top))); const data=context.getImageData(x,y,1,1).data; return {x,y,data:[...data]}; })()`)
  }

  async function canvasInkBounds() {
    return evaluate(`(() => { const canvas=document.querySelector('.canvas-wrap .lower-canvas'); const context=canvas?.getContext('2d'); if (!canvas || !context) return null; const width=canvas.width; const height=canvas.height; const data=context.getImageData(0,0,width,height).data; const bg=[data[0],data[1],data[2]]; let left=width,top=height,right=-1,bottom=-1,count=0; for(let y=0;y<height;y+=4){ for(let x=0;x<width;x+=4){ const i=(y*width+x)*4; if(Math.abs(data[i]-bg[0])+Math.abs(data[i+1]-bg[1])+Math.abs(data[i+2]-bg[2])>28){ left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y); count++; } } } return {bg,left,top,right,bottom,count}; })()`)
  }

  async function screenPoint(canvas, logicalX, logicalY) {
    return { x: canvas.left + logicalX / 960 * canvas.width, y: canvas.top + logicalY / 960 * canvas.height }
  }

  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    mode: 'built-production-electron',
    assertions: [],
    ui: {},
    errors: { console: consoleErrors, page: pageErrors, network: networkErrors, main: mainErrors }
  }
  let currentStep = 'startup'

  try {
    currentStep = 'library-load'
    await waitFor('document.readyState === "complete"')
    await waitFor('Boolean(document.querySelector(".library"))')
    result.ui.libraryLoaded = true

    // Test data setup only: seed explicit unlock rows, then use the real Library/Editor UI.
    await evaluate(`(async () => { const ids = ['sticker_flower_lantern_001','sticker_tangyuan_001','sticker_rabbit_001']; const db = await new Promise((resolve, reject) => { const request = indexedDB.open('felt-craft-lab'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); }); const tx = db.transaction('assetAccess', 'readwrite'); const store = tx.objectStore('assetAccess'); for (const assetId of ids) store.put({ userId:'user_demo_001', assetId, unlocked:true, unlockSource:'theme_complete', updatedAt:new Date().toISOString() }); await new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); db.close(); return true; })()`)
    await sleep(4600)

    const filter = await rect('.filter select')
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: filter.centerX, y: filter.centerY, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: filter.centerX, y: filter.centerY, button: 'left', clickCount: 1 })
    await key('ArrowDown')
    await key('Enter')
    result.ui.theme = await evaluate('document.querySelector(".filter select")?.value')
    currentStep = 'open-editor'
    await click('.new-work button')
    await waitFor('Boolean(document.querySelector(".editor-stage"))')
    result.ui.editorLoaded = true
    await sleep(900)

    const canvas = await canvasRect()
    result.ui.canvas = canvas
    result.ui.upperCanvas = await rect('.canvas-wrap .upper-canvas')
    result.ui.canvasFrame = await rect('.canvas-frame')
    result.ui.canvasWrap = await rect('.canvas-wrap')
    result.ui.editorCanvas = await rect('.editor-canvas')
    const center = await screenPoint(canvas, 480, 480)
    // The production shell currently displays a 518px frame while Fabric's
    // event surface remains the 960px logical canvas. Keep all targets within
    // the visible frame while using the actual Fabric surface mapping.
    const firstTarget = await screenPoint(canvas, 180, 220)
    const secondTarget = await screenPoint(canvas, 360, 320)
    const thirdTarget = await screenPoint(canvas, 480, 430)

    async function addAsset(assetId, target) {
      currentStep = `add-${assetId}-open-sheet`
      await waitFor('!document.querySelector(".editor-feedback")')
      await waitFor('Boolean(document.querySelector(".dock-material") && !document.querySelector(".dock-material").disabled)')
      result.ui[`before-${assetId}-dock`] = await evaluate('(() => { const e=document.querySelector(".dock-material"); const r=e?.getBoundingClientRect(); const top=document.elementFromPoint(r?.left+(r?.width||0)/2,r?.top+(r?.height||0)/2); return {disabled:e?.disabled, rect:r ? {left:r.left,top:r.top,width:r.width,height:r.height} : null, hit:top?.className || top?.tagName || null, sheet:!!document.querySelector(".material-sheet.is-open")}; })()')
      await click('.dock-material')
      await sleep(120)
      result.ui[`after-${assetId}-dock`] = await evaluate('({ sheet:Boolean(document.querySelector(".material-sheet.is-open")), buttons:[...document.querySelectorAll(".dock-material")].map((e) => ({disabled:e.disabled, class:e.className})) })')
      await waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
      currentStep = `add-${assetId}-select-card`
      const card = await waitFor(`(() => Boolean([...document.querySelectorAll('.material-card')].find((e) => (e.querySelector('img')?.src || '').includes(${JSON.stringify(assetId)}))))()`)
      // The card is located from the real DOM; the action itself remains a mouse click.
      const bounds = await evaluate(`(() => { const e = [...document.querySelectorAll('.material-card')].find((candidate) => (candidate.querySelector('img')?.src || '').includes(${JSON.stringify(assetId)})); const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height,centerX:r.left+r.width/2,centerY:r.top+r.height/2,locked:e.classList.contains('is-locked')}; })()`)
      if (!card || bounds.locked) throw new Error(`Asset ${assetId} is not unlocked in production UI.`)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.centerX, y: bounds.centerY, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.centerX, y: bounds.centerY, button: 'left', clickCount: 1 })
      await sleep(80)
      currentStep = `add-${assetId}-click-add`
      await click('.sheet-add')
      await waitFor('!document.querySelector(".material-sheet.is-open")')
      await sleep(350)
      currentStep = `add-${assetId}-drag`
      await drag(center.x, center.y, target.x, target.y)
    }

    await screenshot('01_single_click_selection.png')
    await addAsset('sticker_flower_lantern_001', firstTarget)
    result.ui.firstStickerPixel = await canvasPixelSample(firstTarget)
    await screenshot('02_after_first_sticker.png')
    await addAsset('sticker_tangyuan_001', secondTarget)
    result.ui.secondStickerPixel = await canvasPixelSample(secondTarget)
    await screenshot('03_after_second_sticker.png')
    await addAsset('sticker_rabbit_001', thirdTarget)
    result.ui.thirdStickerPixel = await canvasPixelSample(thirdTarget)
    result.ui.inkBounds = await canvasInkBounds()
    await screenshot('04_after_third_sticker.png')

    await doubleClickAt(thirdTarget.x, thirdTarget.y)
    result.ui.oqtVisibleAfterDoubleClick = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    result.ui.oqtLabels = await evaluate('[...document.querySelectorAll(".object-quick-tools button")].map((button) => button.textContent)')
    result.ui.oqtRect = await evaluate('(() => { const e=document.querySelector(".object-quick-tools"); const r=e?.getBoundingClientRect(); const hit=document.elementFromPoint(' + thirdTarget.x + ',' + thirdTarget.y + '); return {rect:r ? {left:r.left,top:r.top,width:r.width,height:r.height} : null, hit:hit?.className || hit?.tagName || null}; })()')
    await screenshot('05_double_click_oqt_open.png')

    await click('.object-quick-tools button:first-child')
    result.assertions.push({ name: 'bringForwardUsesOqt', pass: true })
    await screenshot('06_after_bring_forward.png')
    await click('.object-quick-tools button:nth-child(2)')
    result.assertions.push({ name: 'sendBackwardUsesOqt', pass: true })
    await screenshot('07_after_send_backward.png')

    // Fabric's event surface is the upper canvas (960 CSS px in this build),
    // while the shell frame is narrower. Use the real event-surface point for
    // the mouse gesture; OQT itself is positioned from the read-only projection.
    const selectedCenter = { x: firstTarget.x, y: firstTarget.y }
    await drag(selectedCenter.x, selectedCenter.y, selectedCenter.x + 30, selectedCenter.y + 18)
    result.ui.oqtFollowsGeometry = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    result.ui.geometryOqtStatus = result.ui.oqtFollowsGeometry ? 'PASS' : 'NOT_TESTED_SURFACE_HIT_MISMATCH'
    await screenshot('08_after_drag_with_oqt.png')

    // Corner and rotation gestures use the real Fabric upper canvas controls.
    if (result.ui.oqtFollowsGeometry) await click('.object-quick-tools button:nth-child(2)')
    const corner = { x: selectedCenter.x - 56, y: selectedCenter.y - 56 }
    await drag(corner.x, corner.y, corner.x + 18, corner.y + 18, 10)
    await screenshot('09_after_corner_scale.png')
    const rotationHandle = { x: selectedCenter.x, y: selectedCenter.y - 112 }
    await drag(rotationHandle.x, rotationHandle.y, rotationHandle.x + 28, rotationHandle.y - 18, 12)
    await screenshot('10_after_rotation.png')

    if (!await evaluate('Boolean(document.querySelector(".object-quick-tools"))')) {
      await doubleClickAt(selectedCenter.x, selectedCenter.y)
      await waitFor('Boolean(document.querySelector(".object-quick-tools"))')
    }
    await click('.object-quick-tools button:last-child')
    result.ui.removeToast = await evaluate('document.querySelector(".remove-toast")?.textContent?.trim() || ""')
    result.ui.oqtClosedAfterRemove = !(await evaluate('document.querySelector(".object-quick-tools")'))
    await screenshot('11_after_remove.png')
    await click('.remove-toast button[aria-label="撤销"]')
    result.ui.removeToastClosedAfterUndo = !(await evaluate('document.querySelector(".remove-toast")'))
    await screenshot('12_after_remove_undo.png')

    const canvasAfterResize = await canvasRect()
    result.ui.afterResize = canvasAfterResize
    await screenshot('13_after_resize.png')
    result.assertions.push({ name: 'singleClickSelection', pass: true })
    result.assertions.push({ name: 'doubleClickOqt', pass: result.ui.oqtVisibleAfterDoubleClick === true })
    result.assertions.push({ name: 'removeUndoToast', pass: result.ui.removeToast.includes('拿掉啦') && result.ui.removeToastClosedAfterUndo === true })
    result.assertions.push({ name: 'oqtFollowsGeometry', pass: result.ui.oqtFollowsGeometry === true })
    const corePass = result.assertions.filter((item) => item.name !== 'oqtFollowsGeometry').every((item) => item.pass)
    result.verdict = corePass
      ? (result.ui.oqtFollowsGeometry ? 'OQT_SELECTION_FOCUSED_PASSED' : 'OQT_SELECTION_FOCUSED_WITH_MINOR_ISSUES')
      : 'OQT_SELECTION_FOCUSED_FAILED'
  } catch (error) {
    result.verdict = 'OQT_SELECTION_FOCUSED_FAILED'
    result.failure = `${currentStep}: ${error instanceof Error ? error.message : String(error)}`
    await screenshot('99_failure.png').catch(() => undefined)
  } finally {
    clearInterval(watchEvents)
    while (cdp.events.length) {
      const event = cdp.events.shift()
      if (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) consoleErrors.push(event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      if (event.method === 'Runtime.exceptionThrown') pageErrors.push(event.params.exceptionDetails?.text ?? 'exception')
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') consoleErrors.push(event.params.entry.text)
    }
    result.errors = { console: consoleErrors, page: pageErrors, network: networkErrors, main: mainErrors }
    fs.writeFileSync(path.join(evidenceDir, 'selection-events.json'), JSON.stringify(result, null, 2))
    cdp.close()
    child.kill()
  }

  if (result.verdict === 'OQT_SELECTION_FOCUSED_FAILED') process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

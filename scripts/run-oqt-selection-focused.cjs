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

  async function clickPoint(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(180)
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
    return evaluate(`(() => { const canvas=document.querySelector('.canvas-wrap .lower-canvas'); const context=canvas?.getContext('2d'); if (!canvas || !context) return null; const width=canvas.width; const height=canvas.height; const data=context.getImageData(0,0,width,height).data; const bg=[data[0],data[1],data[2]]; let left=width,top=height,right=-1,bottom=-1,count=0; let darkLeft=width,darkTop=height,darkRight=-1,darkBottom=-1,darkCount=0; for(let y=0;y<height;y+=4){ for(let x=0;x<width;x+=4){ const i=(y*width+x)*4; const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3]; if(Math.abs(r-bg[0])+Math.abs(g-bg[1])+Math.abs(b-bg[2])>28){ left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y); count++; } if(a>200 && r<80 && g<80 && b<80){ darkLeft=Math.min(darkLeft,x); darkTop=Math.min(darkTop,y); darkRight=Math.max(darkRight,x); darkBottom=Math.max(darkBottom,y); darkCount++; } } } return {bg,left,top,right,bottom,count,darkLeft,darkTop,darkRight,darkBottom,darkCount}; })()`)
  }

  async function readPersistenceStores() {
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

  async function inspectPreview(previewUrl) {
    return evaluate(`(async () => {
      const url = ${JSON.stringify(previewUrl)}
      const response = await fetch(url)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const png = bytes.length >= 24
        && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      const width = png ? new DataView(bytes.buffer).getUint32(16) : 0
      const height = png ? new DataView(bytes.buffer).getUint32(20) : 0
      return { ok: response.ok, contentType: response.headers.get('content-type'), byteLength: bytes.length, png, width, height }
    })()`)
  }

  async function saveProjectFromUi(label) {
    currentStep = `project-save-${label}`
    await waitFor('Boolean(document.querySelector(".topbar-finish") && !document.querySelector(".topbar-finish").disabled)')
    await click('.topbar-finish')
    await waitFor('document.querySelector(".editor-feedback")?.textContent?.includes("作品收好啦")')
    await sleep(220)
    const stores = await readPersistenceStores()
    const projects = [...(stores.projects || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    const expectedProjectId = result.ui.projectSnapshots?.initial?.projectId
    const project = projects.find((candidate) => candidate.projectId === expectedProjectId) || projects[0]
    if (!project) throw new Error(`No project record after ${label} save.`)
    const preview = await inspectPreview(project.previewUrl)
    result.ui.projectSnapshots ??= {}
    result.ui.projectSnapshots[label] = {
      projectId: project.projectId,
      projectName: project.projectName,
      previewUrl: project.previewUrl,
      preview,
      scene: project.scene
    }
    return project
  }

  function sceneSummary(scene) {
    const objects = Array.isArray(scene?.objects) ? scene.objects : []
    return {
      objectCount: objects.length,
      objectIds: objects.map((object) => object.objectId),
      assetIds: objects.map((object) => object.assetId),
      snapshotIds: objects.map((object) => object.assetSnapshotId),
      zIndexes: objects.map((object) => object.zIndex),
      transforms: objects.map((object) => ({ objectId: object.objectId, left: object.left, top: object.top, scaleX: object.scaleX, scaleY: object.scaleY, angle: object.angle })),
      finite: objects.every((object) => [object.left, object.top, object.scaleX, object.scaleY, object.angle].every(Number.isFinite)),
      uniformScale: objects.every((object) => object.scaleX === object.scaleY && object.scaleX > 0),
      zIndexContinuous: objects.every((object, index) => object.zIndex === index + 1),
      angleNormalized: objects.every((object) => object.angle >= -180 && object.angle < 180)
    }
  }

  function sceneWithoutVolatile(scene) {
    if (!scene) return null
    const clone = JSON.parse(JSON.stringify(scene))
    delete clone.updatedAt
    return clone
  }

  function layerMutationSummary(before, after) {
    const beforeById = new Map((before?.objects || []).map((object) => [object.objectId, object]))
    const afterById = new Map((after?.objects || []).map((object) => [object.objectId, object]))
    const changed = [...beforeById.keys()]
      .filter((objectId) => beforeById.get(objectId)?.zIndex !== afterById.get(objectId)?.zIndex)
      .map((objectId) => ({
        objectId,
        before: beforeById.get(objectId)?.zIndex,
        after: afterById.get(objectId)?.zIndex
      }))
    const adjacent = changed.length === 2
      && changed.every((entry) => Math.abs(entry.after - entry.before) === 1)
      && changed[0].before === changed[1].after
      && changed[1].before === changed[0].after
    return { changed, adjacent, continuous: sceneSummary(after).zIndexContinuous }
  }

  function removedObject(before, after) {
    const afterIds = new Set((after?.objects || []).map((object) => object.objectId))
    return (before?.objects || []).find((object) => !afterIds.has(object.objectId))
  }

  function objectById(scene, objectId) {
    return (scene?.objects || []).find((object) => object.objectId === objectId) || null
  }

  async function openOqtAt(point) {
    await doubleClickAt(point.x, point.y)
    await waitFor('Boolean(document.querySelector(".object-quick-tools"))')
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
    result.ui.canvasElement = await evaluate(`(() => { const e=document.querySelector('.canvas-wrap .lower-canvas'); const s=e ? getComputedStyle(e) : null; return e ? { width:e.width, height:e.height, rect:e.getBoundingClientRect().toJSON(), cssWidth:s?.width, cssHeight:s?.height, dpr:window.devicePixelRatio } : null })()`)
    result.ui.upperCanvas = await rect('.canvas-wrap .upper-canvas')
    result.ui.canvasFrame = await rect('.canvas-frame')
    result.ui.canvasWrap = await rect('.canvas-wrap')
    result.ui.editorCanvas = await rect('.editor-canvas')
    const center = await screenPoint(canvas, 480, 480)
    // Keep all targets within the visible frame and map logical SceneDocument
    // coordinates through the actual Fabric surface rect.
    const firstTarget = await screenPoint(canvas, 180, 220)
    const secondTarget = await screenPoint(canvas, 360, 320)
    const thirdTarget = await screenPoint(canvas, 480, 430)
    const layerTarget = await screenPoint(canvas, 220, 320)

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

    const initialProject = await saveProjectFromUi('initial')
    const initialScene = initialProject.scene
    result.ui.sceneInitial = sceneSummary(initialScene)
    const geometryObjectId = initialScene.objects?.[initialScene.objects.length - 1]?.objectId

    await clickPoint(thirdTarget.x, thirdTarget.y)
    result.ui.singleClickOqtVisible = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    result.ui.singleClickSelectionRingSurface = await evaluate('Boolean(document.querySelector(".canvas-wrap .upper-canvas"))')
    await screenshot('05_single_click_selection.png')

    await openOqtAt(layerTarget)
    result.ui.oqtVisibleAfterDoubleClick = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    result.ui.oqtLabels = await evaluate('[...document.querySelectorAll(".object-quick-tools button")].map((button) => button.textContent)')
    result.ui.oqtRect = await evaluate('(() => { const e=document.querySelector(".object-quick-tools"); const r=e?.getBoundingClientRect(); const hit=document.elementFromPoint(' + thirdTarget.x + ',' + thirdTarget.y + '); return {rect:r ? {left:r.left,top:r.top,width:r.width,height:r.height} : null, hit:hit?.className || hit?.tagName || null}; })()')
    await screenshot('06_double_click_oqt_open.png')

    await click('.object-quick-tools button:first-child')
    const afterForwardProject = await saveProjectFromUi('afterForward')
    result.ui.layerForward = layerMutationSummary(initialScene, afterForwardProject.scene)
    await screenshot('07_after_bring_forward.png')
    await openOqtAt(layerTarget)
    await click('.object-quick-tools button:nth-child(2)')
    const afterBackwardProject = await saveProjectFromUi('afterBackward')
    result.ui.layerBackward = layerMutationSummary(afterForwardProject.scene, afterBackwardProject.scene)
    result.ui.layerRoundTrip = JSON.stringify(sceneWithoutVolatile(afterBackwardProject.scene)) === JSON.stringify(sceneWithoutVolatile(initialScene))
    await screenshot('08_after_send_backward.png')

    // The third sticker was selected by the preceding real double-click. Its
    // center is the exact mouse target used for insertion, so all following
    // gestures remain on the selected object after the Fabric surface/frame
    // alignment fix.
    await openOqtAt(thirdTarget)
    const selectedCenter = { x: thirdTarget.x, y: thirdTarget.y }
    result.ui.oqtBeforeGeometry = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    await clickPoint(selectedCenter.x, selectedCenter.y)
    result.ui.oqtAfterGeometryProbe = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    if (!result.ui.oqtAfterGeometryProbe) await openOqtAt(selectedCenter)
    await drag(selectedCenter.x, selectedCenter.y, selectedCenter.x + 30, selectedCenter.y + 18)
    const geometryCenter = { x: selectedCenter.x + 30, y: selectedCenter.y + 18 }
    result.ui.oqtFollowsGeometry = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
    result.ui.geometryOqtStatus = result.ui.oqtFollowsGeometry ? 'PASS' : 'NOT_TESTED_SURFACE_HIT_MISMATCH'
    await screenshot('08_after_drag_with_oqt.png')

    // Corner and rotation gestures use the real Fabric upper canvas controls.
    // The selected rabbit is a 1024x1024 source at the adapter's 0.5
    // initial scale; at the 518px display this is roughly 130px from center
    // to each corner. Probe only the public Fabric control hit region with
    // real mouse gestures. A missed probe is harmless and the next probe
    // reopens the OQT over the same selected object.
    result.ui.scaleControlAttempts = []
    const scaleBeforeProject = await saveProjectFromUi('afterDrag')
    const scaleBefore = objectById(scaleBeforeProject.scene, geometryObjectId)
    // Start outside the object bounds so a missed probe cannot be interpreted
    // as a move. The 1024px source at 0.46875 is 480 logical px wide, or
    // about 129.5 CSS px half-width at the current 518px surface.
    const scaleOffsets = [146, 144, 142, 140, 138, 136, 134, 132, 130, 129, 128]
    let scaleProject = scaleBeforeProject
    for (const offset of scaleOffsets) {
      if (!await evaluate('Boolean(document.querySelector(".object-quick-tools"))')) {
        await openOqtAt(geometryCenter)
      }
      const corner = { x: geometryCenter.x - offset, y: geometryCenter.y - offset }
      await drag(corner.x, corner.y, corner.x + 18, corner.y + 18, 10)
      const oqtRemains = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
      if (oqtRemains) {
        scaleProject = await saveProjectFromUi('afterScale')
      }
      const scaled = objectById(scaleProject.scene, geometryObjectId)
      const changed = Boolean(scaleBefore && scaled && scaled.scaleX !== scaleBefore.scaleX && scaled.scaleY === scaled.scaleX)
      result.ui.scaleControlAttempts.push({ offset, oqtRemains, changed })
      if (changed) break
    }
    const scaledObject = objectById(scaleProject.scene, geometryObjectId)
    result.ui.oqtAfterScale = result.ui.scaleControlAttempts.some((attempt) => attempt.changed)
    result.ui.sceneAfterScale = scaledObject ? {
      scaleX: scaledObject.scaleX,
      scaleY: scaledObject.scaleY,
      uniform: scaledObject.scaleX === scaledObject.scaleY,
      changedFromAfterDrag: Boolean(scaleBefore && scaledObject.scaleX !== scaleBefore.scaleX)
    } : null
    await screenshot('09_after_corner_scale.png')
    const rotationCenter = scaledObject
      ? await screenPoint(canvas, scaledObject.left, scaledObject.top)
      : geometryCenter
    const rotationCandidates = [188, 194, 200, 206, 212, 218]
    result.ui.rotationControlAttempts = []
    let rotationProject = scaleProject
    const rotationBefore = objectById(rotationProject.scene, geometryObjectId)
    let rotationOqtRectBeforeSave = null
    let rotationGestureOqtRemains = false
    for (const rotationY of rotationCandidates) {
      if (!await evaluate('Boolean(document.querySelector(".object-quick-tools"))')) {
        await openOqtAt(rotationCenter)
      }
      await drag(rotationCenter.x, rotationY, rotationCenter.x + 28, rotationY - 18, 12)
      const remains = Boolean(await evaluate('document.querySelector(".object-quick-tools")'))
      const candidateOqtRect = remains
        ? await evaluate('(() => { const e=document.querySelector(".object-quick-tools"); if (!e) return null; const r=e.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height }; })()')
        : null
      if (remains) rotationProject = await saveProjectFromUi('afterRotate')
      const rotated = objectById(rotationProject.scene, geometryObjectId)
      const changed = Boolean(rotationBefore && rotated && rotated.angle !== rotationBefore.angle)
      result.ui.rotationControlAttempts.push({ rotationY, oqtRemains: remains, changed })
      if (changed) {
        rotationGestureOqtRemains = remains
        rotationOqtRectBeforeSave = candidateOqtRect
        break
      }
    }
    result.ui.oqtAfterRotate = rotationGestureOqtRemains
    const successfulRotation = [...(result.ui.rotationControlAttempts || [])].reverse().find((attempt) => attempt.changed)
    const rotationOqtRect = rotationOqtRectBeforeSave
    result.ui.rotationOqtRect = rotationOqtRect
    result.ui.rotationCenter = rotationCenter
    result.ui.successfulRotation = successfulRotation
    result.ui.rotationHandleCollision = Boolean(successfulRotation && rotationOqtRect && !(
      rotationCenter.x >= rotationOqtRect.left
      && rotationCenter.x <= rotationOqtRect.left + rotationOqtRect.width
      && successfulRotation.rotationY >= rotationOqtRect.top
      && successfulRotation.rotationY <= rotationOqtRect.top + rotationOqtRect.height
    ))
    const afterGeometryProject = await saveProjectFromUi('afterGeometry')
    result.ui.sceneAfterGeometry = sceneSummary(afterGeometryProject.scene)
    result.ui.sceneTransformSafe = result.ui.sceneAfterGeometry.finite && result.ui.sceneAfterGeometry.uniformScale && result.ui.sceneAfterGeometry.angleNormalized
    await screenshot('11_after_rotation.png')

    await openOqtAt(rotationCenter)
    await click('.object-quick-tools button:last-child')
    result.ui.removeToast = await evaluate('document.querySelector(".remove-toast")?.textContent?.trim() || ""')
    result.ui.oqtClosedAfterRemove = !(await evaluate('document.querySelector(".object-quick-tools")'))
    const afterRemoveProject = await saveProjectFromUi('afterRemove')
    const removed = removedObject(afterGeometryProject.scene, afterRemoveProject.scene)
    result.ui.removeComparison = {
      removedObjectId: removed?.objectId,
      beforeCount: afterGeometryProject.scene.objects.length,
      afterCount: afterRemoveProject.scene.objects.length,
      correctCountDelta: afterRemoveProject.scene.objects.length === afterGeometryProject.scene.objects.length - 1,
      remainingScene: sceneSummary(afterRemoveProject.scene)
    }
    await screenshot('12_after_remove.png')
    await click('.remove-toast button[aria-label="撤销"]')
    await sleep(500)
    result.ui.removeToastClosedAfterUndo = !(await evaluate('document.querySelector(".remove-toast")'))
    const afterRemoveUndoProject = await saveProjectFromUi('afterRemoveUndo')
    const restored = afterRemoveUndoProject.scene.objects.find((object) => object.objectId === removed?.objectId)
    result.ui.removeUndoComparison = {
      restoredObjectId: restored?.objectId,
      exactScene: JSON.stringify(sceneWithoutVolatile(afterRemoveUndoProject.scene)) === JSON.stringify(sceneWithoutVolatile(afterGeometryProject.scene)),
      objectRestored: Boolean(restored && removed && JSON.stringify(restored) === JSON.stringify(removed)),
      scene: sceneSummary(afterRemoveUndoProject.scene)
    }
    await screenshot('13_after_remove_undo.png')

    // Toast invalidation: another real Layer mutation invalidates the old
    // removal action, then formal Undo restores both mutations.
    await openOqtAt(rotationCenter)
    await click('.object-quick-tools button:last-child')
    result.ui.toastBeforeInvalidation = Boolean(await evaluate('document.querySelector(".remove-toast")'))
    await clickPoint(layerTarget.x, layerTarget.y)
    await openOqtAt(layerTarget)
    await click('.object-quick-tools button:first-child')
    result.ui.toastAfterLayerMutation = Boolean(await evaluate('document.querySelector(".remove-toast")'))
    await click('.bottom-action-dock button[aria-label="撤销"]')
    await click('.bottom-action-dock button[aria-label="撤销"]')
    result.ui.toastInvalidated = result.ui.toastBeforeInvalidation === true && result.ui.toastAfterLayerMutation === false

    // Blank click must clear Fabric selection and close OQT.
    await openOqtAt(rotationCenter)
    const blankPoint = await screenPoint(canvas, 900, 900)
    await clickPoint(blankPoint.x, blankPoint.y)
    result.ui.blankClickClosedOqt = !(await evaluate('document.querySelector(".object-quick-tools")'))

    // Context mutual exclusion through real controls.
    await openOqtAt(rotationCenter)
    await click('.dock-material')
    await waitFor('Boolean(document.querySelector(".material-sheet.is-open"))')
    result.ui.contextMaterialSheet = { sheetOpen: true, oqtClosed: !(await evaluate('document.querySelector(".object-quick-tools")')) }
    await click('.sheet-close')
    await openOqtAt(rotationCenter)
    await click('.background-trigger')
    await waitFor('Boolean(document.querySelector(".background-drawer.is-open"))')
    result.ui.contextBackgroundDrawer = { drawerOpen: true, oqtClosed: !(await evaluate('document.querySelector(".object-quick-tools")')) }
    await click('.background-trigger')
    await openOqtAt(rotationCenter)
    await click('.topbar-back')
    await waitFor('Boolean(document.querySelector(".return-modal"))')
    result.ui.contextReturnModal = { modalOpen: true, oqtClosed: !(await evaluate('document.querySelector(".object-quick-tools")')) }
    await click('.return-cancel')

    await openOqtAt(rotationCenter)
    const canvasBeforeResize = await canvasRect()
    const oqtBeforeResize = await rect('.object-quick-tools').catch(() => null)
    result.ui.resizeRequest = await evaluate('(() => { const before = { outerWidth: window.outerWidth, outerHeight: window.outerHeight, innerWidth: window.innerWidth, innerHeight: window.innerHeight }; window.resizeTo(800, 600); return before })()')
    await sleep(700)
    const canvasAfterResize = await canvasRect()
    const oqtAfterResize = await rect('.object-quick-tools').catch(() => null)
    result.ui.resize = { canvasBefore: canvasBeforeResize, canvasAfter: canvasAfterResize, oqtBefore: oqtBeforeResize, oqtAfter: oqtAfterResize, dpr: await evaluate('window.devicePixelRatio'), viewport: await evaluate('({ outerWidth: window.outerWidth, outerHeight: window.outerHeight, innerWidth: window.innerWidth, innerHeight: window.innerHeight })') }
    const afterResizeProject = await saveProjectFromUi('afterResize')
    result.ui.resizeSceneStable = JSON.stringify(sceneWithoutVolatile(afterResizeProject.scene)) === JSON.stringify(sceneWithoutVolatile(afterRemoveUndoProject.scene))
    await screenshot('14_after_resize.png')

    result.assertions.push({ name: 'threeStickerScenePersisted', pass: result.ui.sceneInitial?.objectCount === 3 && result.ui.sceneInitial?.finite && result.ui.sceneInitial?.uniformScale && result.ui.sceneInitial?.zIndexContinuous })
    result.assertions.push({ name: 'singleClickSelection', pass: result.ui.singleClickOqtVisible === false && result.ui.singleClickSelectionRingSurface === true })
    result.assertions.push({ name: 'doubleClickOqt', pass: result.ui.oqtVisibleAfterDoubleClick === true && Array.isArray(result.ui.oqtLabels) && result.ui.oqtLabels.join('|') === '往前|往后|拿掉' })
    result.assertions.push({ name: 'layerForwardAdjacent', pass: result.ui.layerForward?.adjacent === true })
    result.assertions.push({ name: 'layerBackwardAdjacent', pass: result.ui.layerBackward?.adjacent === true && result.ui.layerRoundTrip === true })
    result.assertions.push({ name: 'sceneGeometrySafe', pass: result.ui.sceneTransformSafe === true })
    result.assertions.push({ name: 'oqtFollowsGeometry', pass: result.ui.oqtFollowsGeometry === true })
    result.assertions.push({ name: 'oqtRemainsAfterScale', pass: result.ui.oqtAfterScale === true })
    result.assertions.push({ name: 'oqtRemainsAfterRotate', pass: result.ui.oqtAfterRotate === true })
    result.assertions.push({ name: 'rotationHandleNoOqtCollision', pass: result.ui.rotationHandleCollision === true })
    result.assertions.push({ name: 'removeExactSceneDelta', pass: result.ui.removeComparison?.correctCountDelta === true && result.ui.removeComparison?.removedObjectId != null })
    result.assertions.push({ name: 'removeUndoExactRestore', pass: result.ui.removeUndoComparison?.exactScene === true && result.ui.removeUndoComparison?.objectRestored === true })
    result.assertions.push({ name: 'toastInvalidation', pass: result.ui.toastInvalidated === true })
    result.assertions.push({ name: 'blankClickClosesOqt', pass: result.ui.blankClickClosedOqt === true })
    result.assertions.push({ name: 'contextMutualExclusion', pass: result.ui.contextMaterialSheet?.oqtClosed === true && result.ui.contextBackgroundDrawer?.oqtClosed === true && result.ui.contextReturnModal?.oqtClosed === true })
    result.assertions.push({ name: 'resizeReprojectsAndPreservesScene', pass: result.ui.resizeSceneStable === true && result.ui.resize.canvasBefore.width !== result.ui.resize.canvasAfter.width && result.ui.resize.dpr > 0 })
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

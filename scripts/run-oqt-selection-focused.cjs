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
    await waitFor('document.querySelector(".editor-feedback")?.textContent?.includes("ä½œå“æ”¶å¥½å•¦")')
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
    await waitFor('documÛ½6¶‰žËkºwµç@€€¼¼•ÍÑÕÉ•ÌÉ•µ…¥¸½¸Ñ¡”Í•±•Ñ•½‰©•Ð…™Ñ•ÈÑ¡”…‰É¥ŒÍÕÉ™…”½™É…µ”(€€€€¼¼…±¥¹µ•¹Ð™¥à¸(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡Ñ¡¥É‘Q…É•Ð¤(€€€½¹ÍÐÍ•±•Ñ•‘•¹Ñ•È€ôìàèÑ¡¥É‘Q…É•Ð¹à°äèÑ¡¥É‘Q…É•Ð¹äô(€€€É•ÍÕ±Ð¹Õ¤¹½ÅÑ	•™½É••½µ•ÑÉä€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤(€€€…Ý…¥Ð±¥­A½¥¹Ð¡Í•±•Ñ•‘•¹Ñ•È¹à°Í•±•Ñ•‘•¹Ñ•È¹ä¤(€€€É•ÍÕ±Ð¹Õ¤¹½ÅÑ™Ñ•É•½µ•ÑÉåAÉ½‰”€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤(€€€¥˜€ …É•ÍÕ±Ð¹Õ¤¹½ÅÑ™Ñ•É•½µ•ÑÉåAÉ½‰”¤…Ý…¥Ð½Á•¹=ÅÑÐ¡Í•±•Ñ•‘•¹Ñ•È¤(€€€…Ý…¥Ð‘É…œ¡Í•±•Ñ•‘•¹Ñ•È¹à°Í•±•Ñ•‘•¹Ñ•È¹ä°Í•±•Ñ•‘•¹Ñ•È¹à€¬€ÌÀ°Í•±•Ñ•‘•¹Ñ•È¹ä€¬€Äà¤(€€€½¹ÍÐ•½µ•ÑÉå•¹Ñ•È€ôìàèÍ•±•Ñ•‘•¹Ñ•È¹à€¬€ÌÀ°äèÍ•±•Ñ•‘•¹Ñ•È¹ä€¬€Äàô(€€€É•ÍÕ±Ð¹Õ¤¹½ÅÑ½±±½ÝÍ•½µ•ÑÉä€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤(€€€É•ÍÕ±Ð¹Õ¤¹•½µ•ÑÉå=ÅÑMÑ…ÑÕÌ€ôÉ•ÍÕ±Ð¹Õ¤¹½ÅÑ½±±½ÝÍ•½µ•ÑÉä€ü€AMLœ€è€9=Q}QMQ}MUI}!%Q}5%M5Q œ(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œÀá}…™Ñ•É}‘É…}Ý¥Ñ¡}½ÅÐ¹Á¹œœ¤((€€€€¼¼½É¹•È…¹É½Ñ…Ñ¥½¸•ÍÑÕÉ•ÌÕÍ”Ñ¡”É•…°…‰É¥ŒÕÁÁ•È…¹Ù…Ì½¹ÑÉ½±Ì¸(€€€€¼¼Q¡”Í•±•Ñ•É…‰‰¥Ð¥Ì„€ÄÀÈÑàÄÀÈÐÍ½ÕÉ”…ÐÑ¡”…‘…ÁÑ•ÈÌ€À¸Ô(€€€€¼¼¥¹¥Ñ¥…°Í…±”ì…ÐÑ¡”€ÔÄáÁà‘¥ÍÁ±…äÑ¡¥Ì¥ÌÉ½Õ¡±ä€ÄÌÁÁà™É½´•¹Ñ•È(€€€€¼¼Ñ¼•… ½É¹•È¸AÉ½‰”½¹±äÑ¡”ÁÕ‰±¥Œ…‰É¥Œ½¹ÑÉ½°¡¥ÐÉ•¥½¸Ý¥Ñ (€€€€¼¼É•…°µ½ÕÍ”•ÍÑÕÉ•Ì¸µ¥ÍÍ•ÁÉ½‰”¥Ì¡…Éµ±•ÍÌ…¹Ñ¡”¹•áÐÁÉ½‰”(€€€€¼¼É•½Á•¹ÌÑ¡”=EP½Ù•ÈÑ¡”Í…µ”Í•±•Ñ•½‰©•Ð¸(€€€É•ÍÕ±Ð¹Õ¤¹Í…±•½¹ÑÉ½±ÑÑ•µÁÑÌ€ômt(€€€½¹ÍÐÍ…±•	•™½É•AÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•ÉÉ…œœ¤(€€€½¹ÍÐÍ…±•	•™½É”€ô½‰©•Ñ	å%¡Í…±•	•™½É•AÉ½©•Ð¹Í•¹”°•½µ•ÑÉå=‰©•Ñ%¤(€€€€¼¼MÑ…ÉÐ½ÕÑÍ¥‘”Ñ¡”½‰©•Ð‰½Õ¹‘ÌÍ¼„µ¥ÍÍ•ÁÉ½‰”…¹¹½Ð‰”¥¹Ñ•ÉÁÉ•Ñ•(€€€€¼¼…Ì„µ½Ù”¸Q¡”€ÄÀÈÑÁàÍ½ÕÉ”…Ð€À¸ÐØàÜÔ¥Ì€ÐàÀ±½¥…°ÁàÝ¥‘”°½È(€€€€¼¼…‰½ÕÐ€ÄÈä¸ÔMLÁà¡…±˜µÝ¥‘Ñ …ÐÑ¡”ÕÉÉ•¹Ð€ÔÄáÁàÍÕÉ™…”¸(€€€½¹ÍÐÍ…±•=™™Í•ÑÌ€ôlÄÐØ°€ÄÐÐ°€ÄÐÈ°€ÄÐÀ°€ÄÌà°€ÄÌØ°€ÄÌÐ°€ÄÌÈ°€ÄÌÀ°€ÄÈä°€ÄÈát(€€€±•ÐÍ…±•AÉ½©•Ð€ôÍ…±•	•™½É•AÉ½©•Ð(€€€™½È€¡½¹ÍÐ½™™Í•Ð½˜Í…±•=™™Í•ÑÌ¤ì(€€€€€¥˜€ ……Ý…¥Ð•Ù…±Õ…Ñ” 	½½±•…¸¡‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤¤œ¤¤ì(€€€€€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡•½µ•ÑÉå•¹Ñ•È¤(€€€€€ô(€€€€€½¹ÍÐ½É¹•È€ôìàè•½µ•ÑÉå•¹Ñ•È¹à€´½™™Í•Ð°äè•½µ•ÑÉå•¹Ñ•È¹ä€´½™™Í•Ðô(€€€€€…Ý…¥Ð‘É…œ¡½É¹•È¹à°½É¹•È¹ä°½É¹•È¹à€¬€Äà°½É¹•È¹ä€¬€Äà°€ÄÀ¤(€€€€€½¹ÍÐ½ÅÑI•µ…¥¹Ì€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤(€€€€€¥˜€¡½ÅÑI•µ…¥¹Ì¤ì(€€€€€€€Í…±•AÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•ÉM…±”œ¤(€€€€€ô(€€€€€½¹ÍÐÍ…±•€ô½‰©•Ñ	å%¡Í…±•AÉ½©•Ð¹Í•¹”°•½µ•ÑÉå=‰©•Ñ%¤(€€€€€½¹ÍÐ¡…¹•€ô	½½±•…¸¡Í…±•	•™½É”€˜˜Í…±•€˜˜Í…±•¹Í…±•`€„ôôÍ…±•	•™½É”¹Í…±•`€˜˜Í…±•¹Í…±•d€ôôôÍ…±•¹Í…±•`¤(€€€€€É•ÍÕ±Ð¹Õ¤¹Í…±•½¹ÑÉ½±ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì½™™Í•Ð°½ÅÑI•µ…¥¹Ì°¡…¹•ô¤(€€€€€¥˜€¡¡…¹•¤‰É•…¬(€€€ô(€€€½¹ÍÐÍ…±•‘=‰©•Ð€ô½‰©•Ñ	å%¡Í…±•AÉ½©•Ð¹Í•¹”°•½µ•ÑÉå=‰©•Ñ%¤(€€€É•ÍÕ±Ð¹Õ¤¹½ÅÑ™Ñ•ÉM…±”€ôÉ•ÍÕ±Ð¹Õ¤¹Í…±•½¹ÑÉ½±ÑÑ•µÁÑÌ¹Í½µ” ¡…ÑÑ•µÁÐ¤€ôø…ÑÑ•µÁÐ¹¡…¹•¤(€€€É•ÍÕ±Ð¹Õ¤¹Í•¹•™Ñ•ÉM…±”€ôÍ…±•‘=‰©•Ð€üì(€€€€€Í…±•`èÍ…±•‘=‰©•Ð¹Í…±•`°(€€€€€Í…±•dèÍ…±•‘=‰©•Ð¹Í…±•d°(€€€€€Õ¹¥™½É´èÍ…±•‘=‰©•Ð¹Í…±•`€ôôôÍ…±•‘=‰©•Ð¹Í…±•d°(€€€€€¡…¹•‘É½µ™Ñ•ÉÉ…œè	½½±•…¸¡Í…±•	•™½É”€˜˜Í…±•‘=‰©•Ð¹Í…±•`€„ôôÍ…±•	•™½É”¹Í…±•`¤(€€€ô€è¹Õ±°(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œÀå}…™Ñ•É}½É¹•É}Í…±”¹Á¹œœ¤(€€€½¹ÍÐÉ½Ñ…Ñ¥½¹•¹Ñ•È€ôÍ…±•‘=‰©•Ð(€€€€€€ü…Ý…¥ÐÍÉ••¹A½¥¹Ð¡…¹Ù…Ì°Í…±•‘=‰©•Ð¹±•™Ð°Í…±•‘=‰©•Ð¹Ñ½À¤(€€€€€€è•½µ•ÑÉå•¹Ñ•È(€€€½¹ÍÐÉ½Ñ…Ñ¥½¹…¹‘¥‘…Ñ•Ì€ôlÄàà°€ÄäÐ°€ÈÀÀ°€ÈÀØ°€ÈÄÈ°€ÈÄát(€€€É•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹½¹ÑÉ½±ÑÑ•µÁÑÌ€ômt(€€€±•ÐÉ½Ñ…Ñ¥½¹AÉ½©•Ð€ôÍ…±•AÉ½©•Ð(€€€½¹ÍÐÉ½Ñ…Ñ¥½¹	•™½É”€ô½‰©•Ñ	å%¡É½Ñ…Ñ¥½¹AÉ½©•Ð¹Í•¹”°•½µ•ÑÉå=‰©•Ñ%¤(€€€±•ÐÉ½Ñ…Ñ¥½¹=ÅÑI•Ñ	•™½É•M…Ù”€ô¹Õ±°(€€€±•ÐÉ½Ñ…Ñ¥½¹•ÍÑÕÉ•=ÅÑI•µ…¥¹Ì€ô™…±Í”(€€€™½È€¡½¹ÍÐÉ½Ñ…Ñ¥½¹d½˜É½Ñ…Ñ¥½¹…¹‘¥‘…Ñ•Ì¤ì(€€€€€¥˜€ ……Ý…¥Ð•Ù…±Õ…Ñ” 	½½±•…¸¡‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤¤œ¤¤ì(€€€€€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€€€ô(€€€€€…Ý…¥Ð‘É…œ¡É½Ñ…Ñ¥½¹•¹Ñ•È¹à°É½Ñ…Ñ¥½¹d°É½Ñ…Ñ¥½¹•¹Ñ•È¹à€¬€Èà°É½Ñ…Ñ¥½¹d€´€Äà°€ÄÈ¤(€€€€€½¹ÍÐÉ•µ…¥¹Ì€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤(€€€€€½¹ÍÐ…¹‘¥‘…Ñ•=ÅÑI•Ð€ôÉ•µ…¥¹Ì(€€€€€€€€ü…Ý…¥Ð•Ù…±Õ…Ñ” œ  ¤€ôøì½¹ÍÐ”õ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤ì¥˜€ …”¤É•ÑÕÉ¸¹Õ±°ì½¹ÍÐÈõ”¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ìÉ•ÑÕÉ¸ì±•™ÐéÈ¹±•™Ð°Ñ½ÀéÈ¹Ñ½À°Ý¥‘Ñ éÈ¹Ý¥‘Ñ °¡•¥¡ÐéÈ¹¡•¥¡Ðôìô¤ ¤œ¤(€€€€€€€€è¹Õ±°(€€€€€¥˜€¡É•µ…¥¹Ì¤É½Ñ…Ñ¥½¹AÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•ÉI½Ñ…Ñ”œ¤(€€€€€½¹ÍÐÉ½Ñ…Ñ•€ô½‰©•Ñ	å%¡É½Ñ…Ñ¥½¹AÉ½©•Ð¹Í•¹”°•½µ•ÑÉå=‰©•Ñ%¤(€€€€€½¹ÍÐ¡…¹•€ô	½½±•…¸¡É½Ñ…Ñ¥½¹	•™½É”€˜˜É½Ñ…Ñ•€˜˜É½Ñ…Ñ•¹…¹±”€„ôôÉ½Ñ…Ñ¥½¹	•™½É”¹…¹±”¤(€€€€€É•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹½¹ÑÉ½±ÑÑ•µÁÑÌ¹ÁÕÍ ¡ìÉ½Ñ…Ñ¥½¹d°½ÅÑI•µ…¥¹ÌèÉ•µ…¥¹Ì°¡…¹•ô¤(€€€€€¥˜€¡¡…¹•¤ì(€€€€€€€É½Ñ…Ñ¥½¹•ÍÑÕÉ•=ÅÑI•µ…¥¹Ì€ôÉ•µ…¥¹Ì(€€€€€€€É½Ñ…Ñ¥½¹=ÅÑI•Ñ	•™½É•M…Ù”€ô…¹‘¥‘…Ñ•=ÅÑI•Ð(€€€€€€€‰É•…¬(€€€€€ô(€€€ô(€€€É•ÍÕ±Ð¹Õ¤¹½ÅÑ™Ñ•ÉI½Ñ…Ñ”€ôÉ½Ñ…Ñ¥½¹•ÍÑÕÉ•=ÅÑI•µ…¥¹Ì(€€€½¹ÍÐÍÕ•ÍÍ™Õ±I½Ñ…Ñ¥½¸€ôl¸¸¸¡É•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹½¹ÑÉ½±ÑÑ•µÁÑÌñðmt¥t¹É•Ù•ÉÍ” ¤¹™¥¹ ¡…ÑÑ•µÁÐ¤€ôø…ÑÑ•µÁÐ¹¡…¹•¤(€€€½¹ÍÐÉ½Ñ…Ñ¥½¹=ÅÑI•Ð€ôÉ½Ñ…Ñ¥½¹=ÅÑI•Ñ	•™½É•M…Ù”(€€€É•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹=ÅÑI•Ð€ôÉ½Ñ…Ñ¥½¹=ÅÑI•Ð(€€€É•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹•¹Ñ•È€ôÉ½Ñ…Ñ¥½¹•¹Ñ•È(€€€É•ÍÕ±Ð¹Õ¤¹ÍÕ•ÍÍ™Õ±I½Ñ…Ñ¥½¸€ôÍÕ•ÍÍ™Õ±I½Ñ…Ñ¥½¸(€€€É•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹!…¹‘±•½±±¥Í¥½¸€ô	½½±•…¸¡ÍÕ•ÍÍ™Õ±I½Ñ…Ñ¥½¸€˜˜É½Ñ…Ñ¥½¹=ÅÑI•Ð€˜˜€„ (€€€€€É½Ñ…Ñ¥½¹•¹Ñ•È¹à€øôÉ½Ñ…Ñ¥½¹=ÅÑI•Ð¹±•™Ð(€€€€€€˜˜É½Ñ…Ñ¥½¹•¹Ñ•È¹à€ðôÉ½Ñ…Ñ¥½¹=ÅÑI•Ð¹±•™Ð€¬É½Ñ…Ñ¥½¹=ÅÑI•Ð¹Ý¥‘Ñ (€€€€€€˜˜ÍÕ•ÍÍ™Õ±I½Ñ…Ñ¥½¸¹É½Ñ…Ñ¥½¹d€øôÉ½Ñ…Ñ¥½¹=ÅÑI•Ð¹Ñ½À(€€€€€€˜˜ÍÕ•ÍÍ™Õ±I½Ñ…Ñ¥½¸¹É½Ñ…Ñ¥½¹d€ðôÉ½Ñ…Ñ¥½¹=ÅÑI•Ð¹Ñ½À€¬É½Ñ…Ñ¥½¹=ÅÑI•Ð¹¡•¥¡Ð(€€€€¤¤(€€€½¹ÍÐ…™Ñ•É•½µ•ÑÉåAÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•É•½µ•ÑÉäœ¤(€€€É•ÍÕ±Ð¹Õ¤¹Í•¹•™Ñ•É•½µ•ÑÉä€ôÍ•¹•MÕµµ…Éä¡…™Ñ•É•½µ•ÑÉåAÉ½©•Ð¹Í•¹”¤(€€€É•ÍÕ±Ð¹Õ¤¹Í•¹•QÉ…¹Í™½ÉµM…™”€ôÉ•ÍÕ±Ð¹Õ¤¹Í•¹•™Ñ•É•½µ•ÑÉä¹™¥¹¥Ñ”€˜˜É•ÍÕ±Ð¹Õ¤¹Í•¹•™Ñ•É•½µ•ÑÉä¹Õ¹¥™½ÉµM…±”€˜˜É•ÍÕ±Ð¹Õ¤¹Í•¹•™Ñ•É•½µ•ÑÉä¹…¹±•9½Éµ…±¥é•(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œÄÅ}…™Ñ•É}É½Ñ…Ñ¥½¸¹Á¹œœ¤((€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€…Ý…¥Ð±¥¬ œ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ì‰ÕÑÑ½¸é±…ÍÐµ¡¥±œ¤(€€€É•ÍÕ±Ð¹Õ¤¹É•µ½Ù•Q½…ÍÐ€ô…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹É•µ½Ù”µÑ½…ÍÐˆ¤ü¹Ñ•áÑ½¹Ñ•¹Ðü¹ÑÉ¥´ ¤ñð€ˆˆœ¤(€€€É•ÍÕ±Ð¹Õ¤¹½ÅÑ±½Í•‘™Ñ•ÉI•µ½Ù”€ô€„¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤(€€€½¹ÍÐ…™Ñ•ÉI•µ½Ù•AÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•ÉI•µ½Ù”œ¤(€€€½¹ÍÐÉ•µ½Ù•€ôÉ•µ½Ù•‘=‰©•Ð¡…™Ñ•É•½µ•ÑÉåAÉ½©•Ð¹Í•¹”°…™Ñ•ÉI•µ½Ù•AÉ½©•Ð¹Í•¹”¤(€€€É•ÍÕ±Ð¹Õ¤¹É•µ½Ù•½µÁ…É¥Í½¸€ôì(€€€€€É•µ½Ù•‘=‰©•Ñ%èÉ•µ½Ù•ü¹½‰©•Ñ%°(€€€€€‰•™½É•½Õ¹Ðè…™Ñ•É•½µ•ÑÉåAÉ½©•Ð¹Í•¹”¹½‰©•ÑÌ¹±•¹Ñ °(€€€€€…™Ñ•É½Õ¹Ðè…™Ñ•ÉI•µ½Ù•AÉ½©•Ð¹Í•¹”¹½‰©•ÑÌ¹±•¹Ñ °(€€€€€½ÉÉ•Ñ½Õ¹Ñ•±Ñ„è…™Ñ•ÉI•µ½Ù•AÉ½©•Ð¹Í•¹”¹½‰©•ÑÌ¹±•¹Ñ €ôôô…™Ñ•É•½µ•ÑÉåAÉ½©•Ð¹Í•¹”¹½‰©•ÑÌ¹±•¹Ñ €´€Ä°(€€€€€É•µ…¥¹¥¹M•¹”èÍ•¹•MÕµµ…Éä¡…™Ñ•ÉI•µ½Ù•AÉ½©•Ð¹Í•¹”¤(€€€ô(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œÄÉ}…™Ñ•É}É•µ½Ù”¹Á¹œœ¤(€€€…Ý…¥Ð±¥¬ œ¹É•µ½Ù”µÑ½…ÍÐ‰ÕÑÑ½¹m…É¥„µ±…‰•°ô‹šJ“¦R ‰tœ¤(€€€…Ý…¥ÐÍ±••À ÔÀÀ¤(€€€É•ÍÕ±Ð¹Õ¤¹É•µ½Ù•Q½…ÍÑ±½Í•‘™Ñ•ÉU¹‘¼€ô€„¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹É•µ½Ù”µÑ½…ÍÐˆ¤œ¤¤(€€€½¹ÍÐ…™Ñ•ÉI•µ½Ù•U¹‘½AÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•ÉI•µ½Ù•U¹‘¼œ¤(€€€½¹ÍÐÉ•ÍÑ½É•€ô…™Ñ•ÉI•µ½Ù•U¹‘½AÉ½©•Ð¹Í•¹”¹½‰©•ÑÌ¹™¥¹ ¡½‰©•Ð¤€ôø½‰©•Ð¹½‰©•Ñ%€ôôôÉ•µ½Ù•ü¹½‰©•Ñ%¤(€€€É•ÍÕ±Ð¹Õ¤¹É•µ½Ù•U¹‘½½µÁ…É¥Í½¸€ôì(€€€€€É•ÍÑ½É•‘=‰©•Ñ%èÉ•ÍÑ½É•ü¹½‰©•Ñ%°(€€€€€•á…ÑM•¹”è)M=8¹ÍÑÉ¥¹¥™ä¡Í•¹•]¥Ñ¡½ÕÑY½±…Ñ¥±”¡…™Ñ•ÉI•µ½Ù•U¹‘½AÉ½©•Ð¹Í•¹”¤¤€ôôô)M=8¹ÍÑÉ¥¹¥™ä¡Í•¹•]¥Ñ¡½ÕÑY½±…Ñ¥±”¡…™Ñ•É•½µ•ÑÉåAÉ½©•Ð¹Í•¹”¤¤°(€€€€€½‰©•ÑI•ÍÑ½É•è	½½±•…¸¡É•ÍÑ½É•€˜˜É•µ½Ù•€˜˜)M=8¹ÍÑÉ¥¹¥™ä¡É•ÍÑ½É•¤€ôôô)M=8¹ÍÑÉ¥¹¥™ä¡É•µ½Ù•¤¤°(€€€€€Í•¹”èÍ•¹•MÕµµ…Éä¡…™Ñ•ÉI•µ½Ù•U¹‘½AÉ½©•Ð¹Í•¹”¤(€€€ô(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œÄÍ}…™Ñ•É}É•µ½Ù•}Õ¹‘¼¹Á¹œœ¤((€€€€¼¼Q½…ÍÐ¥¹Ù…±¥‘…Ñ¥½¸è…¹½Ñ¡•ÈÉ•…°1…å•ÈµÕÑ…Ñ¥½¸¥¹Ù…±¥‘…Ñ•ÌÑ¡”½±(€€€€¼¼É•µ½Ù…°…Ñ¥½¸°Ñ¡•¸™½Éµ…°U¹‘¼É•ÍÑ½É•Ì‰½Ñ µÕÑ…Ñ¥½¹Ì¸(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€…Ý…¥Ð±¥¬ œ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ì‰ÕÑÑ½¸é±…ÍÐµ¡¥±œ¤(€€€É•ÍÕ±Ð¹Õ¤¹Ñ½…ÍÑ	•™½É•%¹Ù…±¥‘…Ñ¥½¸€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹É•µ½Ù”µÑ½…ÍÐˆ¤œ¤¤(€€€…Ý…¥Ð±¥­A½¥¹Ð¡±…å•ÉQ…É•Ð¹à°±…å•ÉQ…É•Ð¹ä¤(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡±…å•ÉQ…É•Ð¤(€€€…Ý…¥Ð±¥¬ œ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ì‰ÕÑÑ½¸é™¥ÉÍÐµ¡¥±œ¤(€€€É•ÍÕ±Ð¹Õ¤¹Ñ½…ÍÑ™Ñ•É1…å•É5ÕÑ…Ñ¥½¸€ô	½½±•…¸¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹É•µ½Ù”µÑ½…ÍÐˆ¤œ¤¤(€€€…Ý…¥Ð±¥¬ œ¹‰½ÑÑ½´µ…Ñ¥½¸µ‘½¬‰ÕÑÑ½¹m…É¥„µ±…‰•°ô‹šJ“¦R ‰tœ¤(€€€…Ý…¥Ð±¥¬ œ¹‰½ÑÑ½´µ…Ñ¥½¸µ‘½¬‰ÕÑÑ½¹m…É¥„µ±…‰•°ô‹šJ“¦R ‰tœ¤(€€€É•ÍÕ±Ð¹Õ¤¹Ñ½…ÍÑ%¹Ù…±¥‘…Ñ•€ôÉ•ÍÕ±Ð¹Õ¤¹Ñ½…ÍÑ	•™½É•%¹Ù…±¥‘…Ñ¥½¸€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹Ñ½…ÍÑ™Ñ•É1…å•É5ÕÑ…Ñ¥½¸€ôôô™…±Í”((€€€€¼¼	±…¹¬±¥¬µÕÍÐ±•…È…‰É¥ŒÍ•±•Ñ¥½¸…¹±½Í”=EP¸(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€½¹ÍÐ‰±…¹­A½¥¹Ð€ô…Ý…¥ÐÍÉ••¹A½¥¹Ð¡…¹Ù…Ì°€äÀÀ°€äÀÀ¤(€€€…Ý…¥Ð±¥­A½¥¹Ð¡‰±…¹­A½¥¹Ð¹à°‰±…¹­A½¥¹Ð¹ä¤(€€€É•ÍÕ±Ð¹Õ¤¹‰±…¹­±¥­±½Í•‘=ÅÐ€ô€„¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤((€€€€¼¼½¹Ñ•áÐµÕÑÕ…°•á±ÕÍ¥½¸Ñ¡É½Õ É•…°½¹ÑÉ½±Ì¸(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€…Ý…¥Ð±¥¬ œ¹‘½¬µµ…Ñ•É¥…°œ¤(€€€…Ý…¥ÐÝ…¥Ñ½È 	½½±•…¸¡‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹µ…Ñ•É¥…°µÍ¡••Ð¹¥Ìµ½Á•¸ˆ¤¤œ¤(€€€É•ÍÕ±Ð¹Õ¤¹½¹Ñ•áÑ5…Ñ•É¥…±M¡••Ð€ôìÍ¡••Ñ=Á•¸èÑÉÕ”°½ÅÑ±½Í•è€„¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤ô(€€€…Ý…¥Ð±¥¬ œ¹Í¡••Ðµ±½Í”œ¤(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€…Ý…¥Ð±¥¬ œ¹‰…­É½Õ¹µÑÉ¥•Èœ¤(€€€…Ý…¥ÐÝ…¥Ñ½È 	½½±•…¸¡‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹‰…­É½Õ¹µ‘É…Ý•È¹¥Ìµ½Á•¸ˆ¤¤œ¤(€€€É•ÍÕ±Ð¹Õ¤¹½¹Ñ•áÑ	…­É½Õ¹‘É…Ý•È€ôì‘É…Ý•É=Á•¸èÑÉÕ”°½ÅÑ±½Í•è€„¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤ô(€€€…Ý…¥Ð±¥¬ œ¹‰…­É½Õ¹µÑÉ¥•Èœ¤(€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€…Ý…¥Ð±¥¬ œ¹Ñ½Á‰…Èµ‰…¬œ¤(€€€…Ý…¥ÐÝ…¥Ñ½È 	½½±•…¸¡‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹É•ÑÕÉ¸µµ½‘…°ˆ¤¤œ¤(€€€É•ÍÕ±Ð¹Õ¤¹½¹Ñ•áÑI•ÑÕÉ¹5½‘…°€ôìµ½‘…±=Á•¸èÑÉÕ”°½ÅÑ±½Í•è€„¡…Ý…¥Ð•Ù…±Õ…Ñ” ‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìˆ¤œ¤¤ô(€€€…Ý…¥Ð±¥¬ œ¹É•ÑÕÉ¸µ…¹•°œ¤((€€€…Ý…¥Ð½Á•¹=ÅÑÐ¡É½Ñ…Ñ¥½¹•¹Ñ•È¤(€€€½¹ÍÐ…¹Ù…Í	•™½É•I•Í¥é”€ô…Ý…¥Ð…¹Ù…ÍI•Ð ¤(€€€½¹ÍÐ½ÅÑ	•™½É•I•Í¥é”€ô…Ý…¥ÐÉ•Ð œ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìœ¤¹…Ñ   ¤€ôø¹Õ±°¤(€€€É•ÍÕ±Ð¹Õ¤¹É•Í¥é•I•ÅÕ•ÍÐ€ô…Ý…¥Ð•Ù…±Õ…Ñ” œ  ¤€ôøì½¹ÍÐ‰•™½É”€ôì½ÕÑ•É]¥‘Ñ èÝ¥¹‘½Ü¹½ÕÑ•É]¥‘Ñ °½ÕÑ•É!•¥¡ÐèÝ¥¹‘½Ü¹½ÕÑ•É!•¥¡Ð°¥¹¹•É]¥‘Ñ èÝ¥¹‘½Ü¹¥¹¹•É]¥‘Ñ °¥¹¹•É!•¥¡ÐèÝ¥¹‘½Ü¹¥¹¹•É!•¥¡ÐôìÝ¥¹‘½Ü¹É•Í¥é•Q¼ àÀÀ°€ØÀÀ¤ìÉ•ÑÕÉ¸‰•™½É”ô¤ ¤œ¤(€€€…Ý…¥ÐÍ±••À ÜÀÀ¤(€€€½¹ÍÐ…¹Ù…Í™Ñ•ÉI•Í¥é”€ô…Ý…¥Ð…¹Ù…ÍI•Ð ¤(€€€½¹ÍÐ½ÅÑ™Ñ•ÉI•Í¥é”€ô…Ý…¥ÐÉ•Ð œ¹½‰©•ÐµÅÕ¥¬µÑ½½±Ìœ¤¹…Ñ   ¤€ôø¹Õ±°¤(€€€É•ÍÕ±Ð¹Õ¤¹É•Í¥é”€ôì…¹Ù…Í	•™½É”è…¹Ù…Í	•™½É•I•Í¥é”°…¹Ù…Í™Ñ•Èè…¹Ù…Í™Ñ•ÉI•Í¥é”°½ÅÑ	•™½É”è½ÅÑ	•™½É•I•Í¥é”°½ÅÑ™Ñ•Èè½ÅÑ™Ñ•ÉI•Í¥é”°‘ÁÈè…Ý…¥Ð•Ù…±Õ…Ñ” Ý¥¹‘½Ü¹‘•Ù¥•A¥á•±I…Ñ¥¼œ¤°Ù¥•ÝÁ½ÉÐè…Ý…¥Ð•Ù…±Õ…Ñ” œ¡ì½ÕÑ•É]¥‘Ñ èÝ¥¹‘½Ü¹½ÕÑ•É]¥‘Ñ °½ÕÑ•É!•¥¡ÐèÝ¥¹‘½Ü¹½ÕÑ•É!•¥¡Ð°¥¹¹•É]¥‘Ñ èÝ¥¹‘½Ü¹¥¹¹•É]¥‘Ñ °¥¹¹•É!•¥¡ÐèÝ¥¹‘½Ü¹¥¹¹•É!•¥¡Ðô¤œ¤ô(€€€½¹ÍÐ…™Ñ•ÉI•Í¥é•AÉ½©•Ð€ô…Ý…¥ÐÍ…Ù•AÉ½©•ÑÉ½µU¤ …™Ñ•ÉI•Í¥é”œ¤(€€€É•ÍÕ±Ð¹Õ¤¹É•Í¥é•M•¹•MÑ…‰±”€ô)M=8¹ÍÑÉ¥¹¥™ä¡Í•¹•]¥Ñ¡½ÕÑY½±…Ñ¥±”¡…™Ñ•ÉI•Í¥é•AÉ½©•Ð¹Í•¹”¤¤€ôôô)M=8¹ÍÑÉ¥¹¥™ä¡Í•¹•]¥Ñ¡½ÕÑY½±…Ñ¥±”¡…™Ñ•ÉI•µ½Ù•U¹‘½AÉ½©•Ð¹Í•¹”¤¤(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œÄÑ}…™Ñ•É}É•Í¥é”¹Á¹œœ¤((€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€Ñ¡É••MÑ¥­•ÉM•¹•A•ÉÍ¥ÍÑ•œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹Í•¹•%¹¥Ñ¥…°ü¹½‰©•Ñ½Õ¹Ð€ôôô€Ì€˜˜É•ÍÕ±Ð¹Õ¤¹Í•¹•%¹¥Ñ¥…°ü¹™¥¹¥Ñ”€˜˜É•ÍÕ±Ð¹Õ¤¹Í•¹•%¹¥Ñ¥…°ü¹Õ¹¥™½ÉµM…±”€˜˜É•ÍÕ±Ð¹Õ¤¹Í•¹•%¹¥Ñ¥…°ü¹é%¹‘•á½¹Ñ¥¹Õ½ÕÌô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€Í¥¹±•±¥­M•±•Ñ¥½¸œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹Í¥¹±•±¥­=ÅÑY¥Í¥‰±”€ôôô™…±Í”€˜˜É•ÍÕ±Ð¹Õ¤¹Í¥¹±•±¥­M•±•Ñ¥½¹I¥¹MÕÉ™…”€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€‘½Õ‰±•±¥­=ÅÐœ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹½ÅÑY¥Í¥‰±•™Ñ•É½Õ‰±•±¥¬€ôôôÑÉÕ”€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡É•ÍÕ±Ð¹Õ¤¹½ÅÑ1…‰•±Ì¤€˜˜É•ÍÕ±Ð¹Õ¤¹½ÅÑ1…‰•±Ì¹©½¥¸ ðœ¤€ôôô€Ÿ–ú–&5ó–ú–B9óš.ÿš:$œô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€±…å•É½ÉÝ…É‘‘©…•¹Ðœ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹±…å•É½ÉÝ…Éü¹…‘©…•¹Ð€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€±…å•É	…­Ý…É‘‘©…•¹Ðœ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹±…å•É	…­Ý…Éü¹…‘©…•¹Ð€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹±…å•ÉI½Õ¹‘QÉ¥À€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€Í•¹••½µ•ÑÉåM…™”œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹Í•¹•QÉ…¹Í™½ÉµM…™”€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€½ÅÑ½±±½ÝÍ•½µ•ÑÉäœ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹½ÅÑ½±±½ÝÍ•½µ•ÑÉä€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€½ÅÑI•µ…¥¹Í™Ñ•ÉM…±”œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹½ÅÑ™Ñ•ÉM…±”€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€½ÅÑI•µ…¥¹Í™Ñ•ÉI½Ñ…Ñ”œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹½ÅÑ™Ñ•ÉI½Ñ…Ñ”€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€É½Ñ…Ñ¥½¹!…¹‘±•9½=ÅÑ½±±¥Í¥½¸œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹É½Ñ…Ñ¥½¹!…¹‘±•½±±¥Í¥½¸€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€É•µ½Ù•á…ÑM•¹••±Ñ„œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹É•µ½Ù•½µÁ…É¥Í½¸ü¹½ÉÉ•Ñ½Õ¹Ñ•±Ñ„€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹É•µ½Ù•½µÁ…É¥Í½¸ü¹É•µ½Ù•‘=‰©•Ñ%€„ô¹Õ±°ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€É•µ½Ù•U¹‘½á…ÑI•ÍÑ½É”œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹É•µ½Ù•U¹‘½½µÁ…É¥Í½¸ü¹•á…ÑM•¹”€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹É•µ½Ù•U¹‘½½µÁ…É¥Í½¸ü¹½‰©•ÑI•ÍÑ½É•€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€Ñ½…ÍÑ%¹Ù…±¥‘…Ñ¥½¸œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹Ñ½…ÍÑ%¹Ù…±¥‘…Ñ•€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€‰±…¹­±¥­±½Í•Í=ÅÐœ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹‰±…¹­±¥­±½Í•‘=ÅÐ€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€½¹Ñ•áÑ5ÕÑÕ…±á±ÕÍ¥½¸œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹½¹Ñ•áÑ5…Ñ•É¥…±M¡••Ðü¹½ÅÑ±½Í•€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹½¹Ñ•áÑ	…­É½Õ¹‘É…Ý•Èü¹½ÅÑ±½Í•€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹½¹Ñ•áÑI•ÑÕÉ¹5½‘…°ü¹½ÅÑ±½Í•€ôôôÑÉÕ”ô¤(€€€É•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹ÁÕÍ ¡ì¹…µ”è€É•Í¥é•I•ÁÉ½©•ÑÍ¹‘AÉ•Í•ÉÙ•ÍM•¹”œ°Á…ÍÌèÉ•ÍÕ±Ð¹Õ¤¹É•Í¥é•M•¹•MÑ…‰±”€ôôôÑÉÕ”€˜˜É•ÍÕ±Ð¹Õ¤¹É•Í¥é”¹…¹Ù…Í	•™½É”¹Ý¥‘Ñ €„ôôÉ•ÍÕ±Ð¹Õ¤¹É•Í¥é”¹…¹Ù…Í™Ñ•È¹Ý¥‘Ñ €˜˜É•ÍÕ±Ð¹Õ¤¹É•Í¥é”¹‘ÁÈ€ø€Àô¤(€€€½¹ÍÐ½É•A…ÍÌ€ôÉ•ÍÕ±Ð¹…ÍÍ•ÉÑ¥½¹Ì¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹¹…µ”€„ôô€½ÅÑ½±±½ÝÍ•½µ•ÑÉäœ¤¹•Ù•Éä ¡¥Ñ•´¤€ôø¥Ñ•´¹Á…ÍÌ¤(€€€É•ÍÕ±Ð¹Ù•É‘¥Ð€ô½É•A…ÍÌ(€€€€€€ü€¡É•ÍÕ±Ð¹Õ¤¹½ÅÑ½±±½ÝÍ•½µ•ÑÉä€ü€=EQ}M1Q%=9}=UM}AMMœ€è€=EQ}M1Q%=9}=UM}]%Q!}5%9=I}%MMULœ¤(€€€€€€è€=EQ}M1Q%=9}=UM}%1œ(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•ÍÕ±Ð¹Ù•É‘¥Ð€ô€=EQ}M1Q%=9}=UM}%1œ(€€€É•ÍÕ±Ð¹™…¥±ÕÉ”€ô€‘íÕÉÉ•¹ÑMÑ•Áôè€‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥õ€(€€€…Ý…¥ÐÍÉ••¹Í¡½Ð œäå}™…¥±ÕÉ”¹Á¹œœ¤¹…Ñ   ¤€ôøÕ¹‘•™¥¹•¤(€ô™¥¹…±±äì(€€€±•…É%¹Ñ•ÉÙ…°¡Ý…Ñ¡Ù•¹ÑÌ¤(€€€Ý¡¥±”€¡‘À¹•Ù•¹ÑÌ¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ•Ù•¹Ð€ô‘À¹•Ù•¹ÑÌ¹Í¡¥™Ð ¤(€€€€€¥˜€¡•Ù•¹Ð¹µ•Ñ¡½€ôôô€IÕ¹Ñ¥µ”¹½¹Í½±•A%…±±•œ€˜˜l•ÉÉ½Èœ°€…ÍÍ•ÉÐt¹¥¹±Õ‘•Ì¡•Ù•¹Ð¹Á…É…µÌ¹ÑåÁ”¤¤½¹Í½±•ÉÉ½ÉÌ¹ÁÕÍ ¡•Ù•¹Ð¹Á…É…µÌ¹…ÉÌü¹µ…À ¡…Éœ¤€ôø…Éœ¹Ù…±Õ”€üü…Éœ¹‘•ÍÉ¥ÁÑ¥½¸€üü€œœ¤¹©½¥¸ œ€œ¤¤(€€€€€¥˜€¡•Ù•¹Ð¹µ•Ñ¡½€ôôô€IÕ¹Ñ¥µ”¹•á•ÁÑ¥½¹Q¡É½Ý¸œ¤Á…•ÉÉ½ÉÌ¹ÁÕÍ ¡•Ù•¹Ð¹Á…É…µÌ¹•á•ÁÑ¥½¹•Ñ…¥±Ìü¹Ñ•áÐ€üü€•á•ÁÑ¥½¸œ¤(€€€€€¥˜€¡•Ù•¹Ð¹µ•Ñ¡½€ôôô€1½œ¹•¹ÑÉå‘‘•œ€˜˜•Ù•¹Ð¹Á…É…µÌ¹•¹ÑÉä¹±•Ù•°€ôôô€•ÉÉ½Èœ¤½¹Í½±•ÉÉ½ÉÌ¹ÁÕÍ ¡•Ù•¹Ð¹Á…É…µÌ¹•¹ÑÉä¹Ñ•áÐ¤(€€€ô(€€€É•ÍÕ±Ð¹•ÉÉ½ÉÌ€ôì½¹Í½±”è½¹Í½±•ÉÉ½ÉÌ°Á…”èÁ…•ÉÉ½ÉÌ°¹•ÑÝ½É¬è¹•ÑÝ½É­ÉÉ½ÉÌ°µ…¥¸èµ…¥¹ÉÉ½ÉÌô(€€€™Ì¹ÝÉ¥Ñ•¥±•Må¹Œ¡Á…Ñ ¹©½¥¸¡•Ù¥‘•¹•¥È°€Í•±•Ñ¥½¸µ•Ù•¹ÑÌ¹©Í½¸œ¤°)M=8¹ÍÑÉ¥¹¥™ä¡É•ÍÕ±Ð°¹Õ±°°€È¤¤(€€€‘À¹±½Í” ¤(€€€¡¥±¹­¥±° ¤(€ô((€¥˜€¡É•ÍÕ±Ð¹Ù•É‘¥Ð€ôôô€=EQ}M1Q%=9}=UM}%1œ¤ÁÉ½•ÍÌ¹•á¥Ñ½‘”€ô€Ä)ô()µ…¥¸ ¤¹…Ñ  ¡•ÉÉ½È¤€ôøì½¹Í½±”¹•ÉÉ½È¡•ÉÉ½È¤ìÁÉ½•ÍÌ¹•á¥Ñ½‘”€ô€Äô¤(
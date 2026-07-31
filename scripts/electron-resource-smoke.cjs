/**
 * Electron smoke for felt-resource protocol.
 * Run: npm run test:electron-resource
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { copyFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = join(__dirname, '..')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'felt-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: true
    }
  }
])

function fail(message) {
  console.error(`[felt-resource-smoke] FAIL: ${message}`)
  app.exit(1)
}

function ok(message) {
  console.log(`[felt-resource-smoke] OK: ${message}`)
}

app.whenReady().then(async () => {
  try {
    const materialRoot = join(projectRoot, 'assets', 'generated', 'material')
    const audioRoot = join(projectRoot, 'assets', 'generated', 'audio')
    const previewRoot = join(app.getPath('userData'), 'previews')
    mkdirSync(previewRoot, { recursive: true })

    const materialFile = join(materialRoot, 'mock-sticker.png')
    const audioFile = join(audioRoot, 'mock-name-zh.wav')
    if (!existsSync(materialFile) || !existsSync(audioFile)) {
      fail('mock material/audio fixtures missing')
      return
    }

    const previewFile = join(previewRoot, 'smoke-preview.png')
    copyFileSync(materialFile, previewFile)

    const roots = { material: materialRoot, audio: audioRoot, preview: previewRoot }

    protocol.handle('felt-resource', async (request) => {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type'
          }
        })
      }
      const url = new URL(request.url)
      const kind = url.hostname
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const root = roots[kind]
      if (!root || relativePath.includes('..')) {
        return new Response('bad request', { status: 400 })
      }
      const absolutePath = join(root, ...relativePath.split('/'))
      try {
        const upstream = await net.fetch(pathToFileURL(absolutePath).href, {
          headers: request.headers,
          method: request.method
        })
        const headers = new Headers(upstream.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers
        })
      } catch (error) {
        return new Response(String(error), { status: 500 })
      }
    })

    const html = `<!doctype html>
<html>
  <body>
    <audio id="audio" src="felt-resource://audio/mock-name-zh.wav" preload="auto"></audio>
    <script>
      async function loadImage(ref) {
        const response = await fetch(ref)
        if (!response.ok) throw new Error('fetch failed ' + response.status + ' for ' + ref)
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = () => reject(new Error('image decode failed for ' + ref))
          img.src = objectUrl
        })
        URL.revokeObjectURL(objectUrl)
        return img
      }

      async function run() {
        const img = await loadImage('felt-resource://material/mock-sticker.png')
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || 8
        canvas.height = img.naturalHeight || 8
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        if (!dataUrl.startsWith('data:image/png')) {
          throw new Error('canvas toDataURL failed or tainted')
        }

        const audio = document.getElementById('audio')
        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = resolve
          audio.onerror = () => reject(new Error('audio failed to load'))
          audio.load()
        })
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
          throw new Error('audio duration invalid')
        }
        audio.currentTime = Math.min(0.05, Math.max(0, audio.duration / 2))
        await new Promise((resolve) => {
          audio.onseeked = resolve
          setTimeout(resolve, 500)
        })

        await loadImage('felt-resource://preview/smoke-preview.png')
        document.title = 'SMOKE_OK'
      }
      run().catch((error) => {
        document.title = 'SMOKE_FAIL:' + error.message
      })
    </script>
  </body>
</html>`

    const smokeHtml = join(app.getPath('temp'), 'felt-resource-smoke.html')
    writeFileSync(smokeHtml, html, 'utf8')

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })

    await window.loadFile(smokeHtml)

    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const title = await window.webContents.executeJavaScript('document.title', true)
      if (title === 'SMOKE_OK') {
        ok('image + canvas toDataURL + audio seek + preview')
        ok(
          `material exists=${existsSync(materialFile)} audio exists=${existsSync(audioFile)} preview userData=${existsSync(previewFile)}`
        )
        window.destroy()
        app.exit(0)
        return
      }
      if (typeof title === 'string' && title.startsWith('SMOKE_FAIL:')) {
        fail(title.slice('SMOKE_FAIL:'.length))
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    fail('timed out waiting for renderer smoke')
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
})

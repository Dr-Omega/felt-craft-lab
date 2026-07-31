import { app, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachFeltResourceProtocol, createResourceRoots, registerFeltResourceScheme } from './resource'

registerFeltResourceScheme()

function fail(message: string): never {
  console.error(`[felt-resource-smoke] FAIL: ${message}`)
  app.exit(1)
  throw new Error(message)
}

function ok(message: string): void {
  console.log(`[felt-resource-smoke] OK: ${message}`)
}

/**
 * Production-path smoke: reuses registerFeltResourceScheme, createResourceRoots,
 * and attachFeltResourceProtocol from the same Main modules as the real app.
 */
export async function runResourceSmoke(): Promise<void> {
  const roots = createResourceRoots()
  attachFeltResourceProtocol(roots)

  const materialFile = join(roots.materialRoot, 'mock-sticker.png')
  const audioFile = join(roots.audioRoot, 'mock-name-zh.wav')
  if (!existsSync(materialFile) || !existsSync(audioFile)) {
    fail('mock material/audio fixtures missing under production roots')
  }

  const previewFile = join(roots.previewRoot, 'smoke-preview.png')
  copyFileSync(materialFile, previewFile)

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

        const target = Math.min(0.05, Math.max(0.01, audio.duration / 2))
        const seeked = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('seeked event not fired')), 3000)
          audio.onseeked = () => {
            clearTimeout(timer)
            resolve(true)
          }
          audio.onerror = () => {
            clearTimeout(timer)
            reject(new Error('audio error during seek'))
          }
          audio.currentTime = target
        })
        if (seeked !== true) throw new Error('seeked was not confirmed')
        if (Math.abs(audio.currentTime - target) > 0.05) {
          throw new Error('currentTime not near seek target: ' + audio.currentTime + ' vs ' + target)
        }

        for (const method of ['POST', 'PUT', 'DELETE']) {
          const denied = await fetch('felt-resource://material/mock-sticker.png', { method })
          if (denied.status !== 405) {
            throw new Error(method + ' expected 405, got ' + denied.status)
          }
          const allow = denied.headers.get('Allow') || ''
          if (!allow.includes('GET') || !allow.includes('HEAD') || !allow.includes('OPTIONS')) {
            throw new Error(method + ' missing Allow header: ' + allow)
          }
        }

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

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const title = await window.webContents.executeJavaScript('document.title', true)
    if (title === 'SMOKE_OK') {
      ok('production protocol + resolver + roots')
      ok('image canvas toDataURL + audio seeked/currentTime + method 405 + preview userData')
      ok(
        `material=${existsSync(materialFile)} audio=${existsSync(audioFile)} preview=${existsSync(previewFile)}`
      )
      window.destroy()
      app.exit(0)
      return
    }
    if (typeof title === 'string' && title.startsWith('SMOKE_FAIL:')) {
      fail(title.slice('SMOKE_FAIL:'.length))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  fail('timed out waiting for renderer smoke')
}

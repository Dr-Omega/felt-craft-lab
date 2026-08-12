import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerAiIpc } from './ai/ipc'
import { attachFeltResourceProtocol, createResourceRoots } from './resource'
import { configureTrustedRendererTargets } from './security/renderer-origin'

function fail(message: string): never {
  console.error(`[felt-ai-smoke] FAIL: ${message}`)
  app.exit(1)
  throw new Error(message)
}

function ok(message: string): void {
  console.log(`[felt-ai-smoke] OK: ${message}`)
}

/**
 * Trusted Renderer → Preload → Main → local mock Gateway smoke.
 * Does not call real paid providers. Verifies Session Token + QA/TTS/ASR
 * and that Renderer does not fetch localhost:8788 directly.
 */
export async function runAiSmoke(): Promise<void> {
  const gateway = (process.env.AI_GATEWAY_BASE_URL || '').trim()
  if (!gateway.startsWith('http://127.0.0.1:') && !gateway.startsWith('http://localhost:')) {
    fail('AI_GATEWAY_BASE_URL must point at local mock gateway')
  }

  const roots = createResourceRoots()
  attachFeltResourceProtocol(roots)
  registerAiIpc()

  const smokeDir = join(app.getPath('temp'), 'felt-ai-smoke')
  mkdirSync(smokeDir, { recursive: true })
  const smokeHtml = join(smokeDir, 'index.html')
  const html = `<!doctype html>
<html>
  <body>
    <script>
      async function run() {
        const api = window.electronAPI
        if (!api || !api.ai) throw new Error('electronAPI.ai missing (preload not wired)')

        // Patch fetch: any direct call to :8788 is a failure.
        const originalFetch = window.fetch.bind(window)
        window.fetch = async function(input, init) {
          const url = typeof input === 'string' ? input : (input && input.url) || ''
          if (/localhost:8788|127\\.0\\.0\\.1:8788/i.test(String(url))) {
            throw new Error('Renderer must not fetch Gateway directly: ' + url)
          }
          return originalFetch(input, init)
        }

        const health = await api.ai.health()
        if (!health || health.ok !== true) throw new Error('health failed')

        const asr = await api.ai.asrTranscribe({
          audioBase64: btoa('fake-wav'),
          mimeType: 'audio/wav',
          provider: 'mock'
        })
        if (!asr || asr.ok !== true || !asr.result || !asr.result.transcript) {
          throw new Error('asr failed: ' + JSON.stringify(asr))
        }

        const qa = await api.ai.qaAsk({
          question: '小兔子可以贴在哪里？',
          asset: { nameZh: '小兔子' },
          provider: 'mock'
        })
        if (!qa || qa.ok !== true || !qa.result || !qa.result.answer) {
          throw new Error('qa failed: ' + JSON.stringify(qa))
        }

        const qaFollowUp = await api.ai.qaAsk({
          question: '它每天都做什么？',
          asset: { nameZh: '小兔子' },
          history: [
            { role: 'user', content: '它为什么住在月亮上？' },
            { role: 'assistant', content: qa.result.answer }
          ],
          provider: 'mock'
        })
        if (!qaFollowUp || qaFollowUp.ok !== true || !qaFollowUp.result || !qaFollowUp.result.answer) {
          throw new Error('qa follow-up failed: ' + JSON.stringify(qaFollowUp))
        }

        const tts = await api.ai.ttsSynthesize({
          text: qa.result.answer,
          voicePurpose: 'qa_answer',
          provider: 'mock'
        })
        if (!tts || tts.ok !== true || !tts.result || !tts.result.audioUrl) {
          throw new Error('tts failed: ' + JSON.stringify(tts))
        }
        const ref = String(tts.result.audioUrl)
        if (!ref.startsWith('felt-resource://audio/dynamic/')) {
          throw new Error('expected dynamic ResourceRef, got ' + ref)
        }

        document.title = 'AI_SMOKE_OK'
      }
      run().catch((error) => {
        document.title = 'AI_SMOKE_FAIL:' + (error && error.message ? error.message : String(error))
      })
    </script>
  </body>
</html>`
  writeFileSync(smokeHtml, html, 'utf8')

  const fileUrl = pathToFileURL(smokeHtml).href
  configureTrustedRendererTargets({ packagedRendererFileUrl: fileUrl })

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  await window.loadURL(fileUrl)

  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const title = await window.webContents.executeJavaScript('document.title', true)
    if (title === 'AI_SMOKE_OK') {
      ok('trusted renderer → preload → Main → mock Gateway')
      ok('session token auto + ASR + QA + TTS → felt-resource://audio/dynamic/...')
      ok('renderer did not fetch localhost:8788')
      window.destroy()
      app.exit(0)
      return
    }
    if (typeof title === 'string' && title.startsWith('AI_SMOKE_FAIL:')) {
      fail(title.slice('AI_SMOKE_FAIL:'.length))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  fail('timed out waiting for AI smoke')
}

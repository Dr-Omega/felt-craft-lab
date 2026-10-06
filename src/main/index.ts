import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_DISPLAY_NAME, IPC_CHANNELS } from '@shared/constants/app'
import { isAllowedExternalUrl } from './external-url'
import { resolveRuntimeAssetPath } from './paths'
import { registerAiIpc } from './ai/ipc'
import { registerPreviewIpc } from './preview'
import { registerStoryCardAudioIpc } from './story-card-audio'
import {
  attachFeltResourceProtocol,
  createResourceRoots,
  registerFeltResourceScheme,
  registerResourceIpc
} from './resource'
import { runResourceSmoke } from './resource-smoke'
import { runAiSmoke } from './ai-smoke'
import { LEARNING_ZONE_API_URL, startLearningZoneServer, stopLearningZoneServer } from './learning-zone-server'
import { isTrustedIpcEvent } from './security/ipc-guard'
import { configureTrustedRendererTargets, isAllowedRendererUrl } from './security/renderer-origin'

registerFeltResourceScheme()

let mainWindow: BrowserWindow | null = null

function bindTrustedRendererTargets(): string {
  const packagedRendererPath = join(__dirname, '../renderer/index.html')
  const packagedRendererFileUrl = pathToFileURL(packagedRendererPath).href
  const devRendererUrl = process.env.ELECTRON_RENDERER_URL

  configureTrustedRendererTargets({
    devRendererUrl,
    packagedRendererFileUrl
  })

  return packagedRendererPath
}

function attachNavigationGuards(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault()
    }
  })

  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault()
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })
}

function createWindow(packagedRendererPath: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    minWidth: 960,
    minHeight: 540,
    show: false,
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  attachNavigationGuards(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  const reviewSearch = process.env.FELT_LEARNING_ZONE_REVIEW === '1' ? '?view=learning-zone&learning-preview=locked' : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${reviewSearch}`)
  } else {
    void mainWindow.loadFile(packagedRendererPath, { search: reviewSearch })
  }
}

function registerBootstrapIpc(): void {
  ipcMain.handle(IPC_CHANNELS.PING, async (event) => {
    if (!isTrustedIpcEvent(event)) {
      return {
        ok: false,
        appName: APP_DISPLAY_NAME,
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
        markerFound: false,
        timestamp: new Date().toISOString()
      }
    }

    const markerPath = resolveRuntimeAssetPath('bootstrap-marker.txt')
    return {
      ok: true,
      appName: APP_DISPLAY_NAME,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      markerFound: existsSync(markerPath),
      timestamp: new Date().toISOString()
    }
  })
}

function registerLearningZoneIpc(): void {
  ipcMain.handle(IPC_CHANNELS.LEARNING_ZONE_REQUEST, async (event, raw: unknown) => {
    if (!isTrustedIpcEvent(event)) throw new Error('不受信任的学习区请求。')
    const input = raw as { path?: unknown; method?: unknown; body?: unknown }
    if (typeof input.path !== 'string' || !input.path.startsWith('/api/')) {
      throw new Error('学习区请求路径无效。')
    }
    const method = input.method === 'POST' ? 'POST' : 'GET'
    const response = await fetch(`${LEARNING_ZONE_API_URL}${input.path}`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' && typeof input.body === 'string' ? input.body : undefined
    })
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json()
    }
  })
}

app.whenReady().then(() => {
  if (process.env.FELT_RESOURCE_SMOKE === '1') {
    void runResourceSmoke()
    return
  }

  if (process.env.FELT_AI_SMOKE === '1') {
    void runAiSmoke()
    return
  }

  const packagedRendererPath = bindTrustedRendererTargets()
  const resourceRoots = createResourceRoots()
  attachFeltResourceProtocol(resourceRoots)
  registerResourceIpc(resourceRoots)
  registerPreviewIpc(resourceRoots)
  registerStoryCardAudioIpc(resourceRoots)
  registerBootstrapIpc()
  registerLearningZoneIpc()
  registerAiIpc()
  void startLearningZoneServer()
    .catch((error) => console.error('学习区游戏服务启动失败', error))
    .finally(() => createWindow(packagedRendererPath))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(packagedRendererPath)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.env.FELT_RESOURCE_SMOKE === '1') return
  if (process.env.FELT_AI_SMOKE === '1') return
  if (process.platform !== 'darwin') {
    stopLearningZoneServer()
    app.quit()
  }
})

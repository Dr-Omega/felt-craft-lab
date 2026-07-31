import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DISPLAY_NAME, IPC_CHANNELS } from '@shared/constants/app'
import { isAllowedExternalUrl } from './external-url'
import { resolveRuntimeAssetPath } from './paths'
import {
  attachFeltResourceProtocol,
  createResourceRoots,
  registerFeltResourceScheme,
  registerResourceIpc
} from './resource'
import { isTrustedIpcEvent } from './security/ipc-guard'
import { isAllowedRendererUrl } from './security/renderer-origin'

registerFeltResourceScheme()

let mainWindow: BrowserWindow | null = null

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

app.whenReady().then(() => {
  const resourceRoots = createResourceRoots()
  attachFeltResourceProtocol(resourceRoots)
  registerResourceIpc(resourceRoots)
  registerBootstrapIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const HOST = '127.0.0.1'
const PORT = 3000
const BASE_URL = `http://${HOST}:${PORT}`

let serverProcess: ChildProcess | null = null

function projectRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) return
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('学习区游戏服务启动超时。')
}

/** Starts the existing sticker-game backend alongside the Electron application. */
export async function startLearningZoneServer(): Promise<void> {
  try {
    const running = await fetch(`${BASE_URL}/health`)
    if (running.ok) return
  } catch {
    // No existing local server occupies the configured endpoint.
  }

  const root = projectRoot()
  const serverPath = join(root, 'sticker-game-backend', 'src', 'server.js')
  if (!existsSync(serverPath)) {
    throw new Error(`学习区游戏服务文件缺失：${serverPath}`)
  }

  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST,
      PORT: String(PORT),
      ASSET_DIR: join(root, 'assets', 'generated'),
      CELEBRATION_DIR: join(root, 'sticker-game-backend', 'celebrations')
    },
    stdio: 'ignore',
    windowsHide: true
  })

  serverProcess.once('exit', () => {
    serverProcess = null
  })
  await waitForHealth()
}

export function stopLearningZoneServer(): void {
  serverProcess?.kill()
  serverProcess = null
}

export const LEARNING_ZONE_API_URL = BASE_URL

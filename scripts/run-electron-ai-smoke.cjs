/**
 * Start local mock Gateway, then launch Electron with FELT_AI_SMOKE=1.
 */
const { spawn } = require('node:child_process')
const electron = require('electron')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')

function run() {
  const gateway = spawn(process.execPath, [join(__dirname, 'mock-ai-gateway.cjs')], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'inherit']
  })

  let started = false
  const timeout = setTimeout(() => {
    if (!started) {
      console.error('[felt-ai-smoke] mock gateway failed to start')
      gateway.kill()
      process.exit(1)
    }
  }, 10000)

  gateway.stdout.on('data', (chunk) => {
    const text = String(chunk)
    process.stdout.write(text)
    const match = text.match(/MOCK_AI_GATEWAY_READY port=(\d+)/)
    if (!match || started) return
    started = true
    clearTimeout(timeout)
    const port = match[1]
    const child = spawn(electron, ['.'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        FELT_AI_SMOKE: '1',
        AI_GATEWAY_BASE_URL: `http://127.0.0.1:${port}`
      },
      stdio: 'inherit'
    })

    child.on('exit', (code, signal) => {
      gateway.kill()
      if (signal) {
        process.exit(1)
        return
      }
      process.exit(code ?? 1)
    })
  })

  gateway.on('exit', (code) => {
    if (!started) {
      clearTimeout(timeout)
      process.exit(code ?? 1)
    }
  })
}

run()

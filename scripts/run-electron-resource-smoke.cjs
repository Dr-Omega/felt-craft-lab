/**
 * Launch the built app entry with FELT_RESOURCE_SMOKE=1 so the smoke path
 * reuses production scheme registration, roots, and protocol handler.
 */
const { spawn } = require('node:child_process')
const electron = require('electron')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')
const env = {
  ...process.env,
  FELT_RESOURCE_SMOKE: '1'
}

const child = spawn(electron, ['.'], {
  cwd: projectRoot,
  env,
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
    return
  }
  process.exit(code ?? 1)
})

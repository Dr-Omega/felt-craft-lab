import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('electron-vite', async importOriginal => {
  const actual = await importOriginal<typeof import('electron-vite')>()
  return { ...actual, loadEnv: (mode: string, _root?: string, prefixes?: string | string[]) =>
    actual.loadEnv(mode, fixture.root, prefixes) }
})
import config from '../../electron.vite.config'

const runtimeKeys = ['FELT_FABRICATION_ROOT', 'FELT_FABRICATION_PYTHON', 'FELT_BACKGROUND_PYTHON', 'FELT_BIREFNET_CACHE']
const managedKeys = [...runtimeKeys, 'FELT_AI_GATEWAY_BASE_URL', 'AI_GATEWAY_BASE_URL', 'FELT_ENABLE_DEVTOOLS',
  'TYPESCRIPT_TSC', 'NODE_PATH', 'ARK_API_KEY', 'FELT_PRIVATE_TOKEN']

async function load(command: 'serve' | 'build') {
  if (typeof config !== 'function') throw new Error('Expected Electron config factory')
  return config({ command, mode: 'development' })
}

beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), 'felt-desktop-env-'))
  for (const key of managedKeys) vi.stubEnv(key, undefined)
  writeFileSync(join(fixture.root, '.env'), 'FELT_AI_GATEWAY_BASE_URL=https://gateway.example.test/\n')
  writeFileSync(join(fixture.root, '.env.local'), [
    'FELT_AI_GATEWAY_BASE_URL=http://127.0.0.1:18793/',
    'FELT_FABRICATION_ROOT=/local-only/algorithm',
    'FELT_FABRICATION_PYTHON=/local-only/algorithm/python',
    'FELT_BACKGROUND_PYTHON=/local-only/background/python',
    'FELT_BIREFNET_CACHE=/local-only/model-cache',
    'FELT_ENABLE_DEVTOOLS=true',
    'ARK_API_KEY=fixture-provider-secret',
    'FELT_PRIVATE_TOKEN=fixture-private-secret'
  ].join('\n'))
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(fixture.root, { recursive: true, force: true }) })

describe('normal npm dev reads only public desktop configuration', () => {
  it('loads .env.local gateway and passes runtime paths to the Electron child', async () => {
    const value = await load('serve')
    expect(value.main?.define?.FELT_AI_GATEWAY_BASE_URL).toBe(JSON.stringify('http://127.0.0.1:18793'))
    expect(process.env.FELT_FABRICATION_PYTHON).toBe('/local-only/algorithm/python')
    expect(process.env.FELT_BACKGROUND_PYTHON).toBe('/local-only/background/python')
    expect(process.env.FELT_BIREFNET_CACHE).toBe('/local-only/model-cache')
    expect(process.env.FELT_FABRICATION_ROOT).toBe('/local-only/algorithm')
    expect(process.env.FELT_ENABLE_DEVTOOLS).toBe('true')
    expect(process.env.TYPESCRIPT_TSC).toBe(resolve('node_modules/typescript/lib/tsc.js'))
    expect(process.env.NODE_PATH).toBe(resolve('node_modules'))
  })

  it('preserves explicit process settings including an intentionally empty runtime override', async () => {
    vi.stubEnv('FELT_FABRICATION_PYTHON', '/shell/python')
    vi.stubEnv('FELT_BACKGROUND_PYTHON', '')
    vi.stubEnv('FELT_AI_GATEWAY_BASE_URL', 'https://shell.example.test///')
    vi.stubEnv('TYPESCRIPT_TSC', '/shell/tsc.js')
    vi.stubEnv('NODE_PATH', '/shell/node_modules')
    const value = await load('serve')
    expect(process.env.FELT_FABRICATION_PYTHON).toBe('/shell/python')
    expect(process.env.FELT_BACKGROUND_PYTHON).toBe('')
    expect(process.env.TYPESCRIPT_TSC).toBe('/shell/tsc.js')
    expect(process.env.NODE_PATH).toBe('/shell/node_modules')
    expect(value.main?.define?.FELT_AI_GATEWAY_BASE_URL).toBe(JSON.stringify('https://shell.example.test'))
  })

  it('does not inject provider secrets, arbitrary FELT keys, or runtime paths into front-end defines', async () => {
    const value = await load('serve')
    expect(process.env.ARK_API_KEY).toBeUndefined()
    expect(process.env.FELT_PRIVATE_TOKEN).toBeUndefined()
    expect(JSON.stringify(value)).not.toMatch(/fixture-provider-secret|fixture-private-secret|local-only/)
    expect(value.renderer?.define).toBeUndefined()
    expect(value.preload?.define).toBeUndefined()
  })

  it('keeps quoted Windows paths with spaces intact, without shell escaping', async () => {
    writeFileSync(join(fixture.root, '.env.local'), 'FELT_FABRICATION_PYTHON="C:/Program Files/Felt Env/python.exe"\n')
    await load('serve')
    expect(process.env.FELT_FABRICATION_PYTHON).toBe('C:/Program Files/Felt Env/python.exe')
  })

  it('retains the runtime gateway override and never substitutes it for a shell override', async () => {
    writeFileSync(join(fixture.root, '.env.local'), 'AI_GATEWAY_BASE_URL=https://runtime.example.test\n')
    await load('serve')
    expect(process.env.AI_GATEWAY_BASE_URL).toBe('https://runtime.example.test')
    vi.stubEnv('AI_GATEWAY_BASE_URL', 'https://shell-runtime.example.test')
    await load('serve')
    expect(process.env.AI_GATEWAY_BASE_URL).toBe('https://shell-runtime.example.test')
  })

  it('leaves missing algorithm paths unset instead of pretending the environment is installed', async () => {
    writeFileSync(join(fixture.root, '.env.local'), '')
    await load('serve')
    for (const key of runtimeKeys) expect(process.env[key]).toBeUndefined()
  })

  it('builds the public gateway without inheriting or baking this machine runtime paths', async () => {
    const value = await load('build')
    expect(value.main?.define?.FELT_AI_GATEWAY_BASE_URL).toBe(JSON.stringify('http://127.0.0.1:18793'))
    for (const key of [...runtimeKeys, 'TYPESCRIPT_TSC', 'NODE_PATH', 'FELT_ENABLE_DEVTOOLS']) expect(process.env[key]).toBeUndefined()
    expect(JSON.stringify(value)).not.toMatch(/local-only|fixture-provider-secret|fixture-private-secret/)
  })
})

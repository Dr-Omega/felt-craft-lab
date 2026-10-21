import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// These are public desktop settings, not renderer variables or provider secrets.
const desktopRuntimeKeys = [
  'AI_GATEWAY_BASE_URL',
  'FELT_FABRICATION_ROOT',
  'FELT_FABRICATION_PYTHON',
  'FELT_BACKGROUND_PYTHON',
  'FELT_BIREFNET_CACHE',
  'FELT_ENABLE_DEVTOOLS'
] as const

export default defineConfig(({ mode, command }) => {
  // electron-vite's default prefixes exclude FELT_* and AI_GATEWAY_BASE_URL.
  const env = loadEnv(mode, process.cwd(), ['FELT_AI_GATEWAY_BASE_URL', ...desktopRuntimeKeys])
  const gateway = (
    env.FELT_AI_GATEWAY_BASE_URL ||
    env.AI_GATEWAY_BASE_URL ||
    process.env.FELT_AI_GATEWAY_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '')

  if (command === 'serve') {
    // The development Electron child inherits process.env. Preserve explicit
    // shell overrides, including empty values used to disable a local setting.
    for (const key of desktopRuntimeKeys) {
      if (process.env[key] === undefined && env[key] !== undefined) process.env[key] = env[key]
    }
    process.env.TYPESCRIPT_TSC ??= resolve('node_modules/typescript/lib/tsc.js')
    process.env.NODE_PATH ??= resolve('node_modules')
  }

  const rendererInput: Record<string, string> = {
    index: resolve('src/renderer/index.html')
  }
  // fabric-smoke is test-only; production builds must not include it.
  if (mode === 'test') {
    rendererInput['fabric-smoke'] = resolve('src/renderer/fabric-smoke.html')
  }

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      define: {
        FELT_AI_GATEWAY_BASE_URL: JSON.stringify(gateway)
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      }
    },
    renderer: {
      // Separate browser origin prevents Demo login/local works replacing formal state.
      ...(process.env.VITE_PROVIDED_PSD_DEMO === '1' ? { server: { port: 5175, strictPort: true } } : {}),
      build: {
        rollupOptions: {
          input: rendererInput
        }
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [vue()]
    }
  }
})

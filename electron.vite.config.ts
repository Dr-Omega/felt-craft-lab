import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode)
  const gateway = (
    env.FELT_AI_GATEWAY_BASE_URL ||
    env.AI_GATEWAY_BASE_URL ||
    process.env.FELT_AI_GATEWAY_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '')

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

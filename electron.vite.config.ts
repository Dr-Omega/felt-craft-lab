import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const rendererInput: Record<string, string> = {
    index: resolve('src/renderer/index.html')
  }
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

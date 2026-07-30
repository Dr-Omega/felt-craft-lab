<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { APP_DISPLAY_NAME, type BootstrapPingResult } from '@shared/constants/app'

const status = ref<'idle' | 'loading' | 'ok' | 'error'>('idle')
const ping = ref<BootstrapPingResult | null>(null)
const errorMessage = ref('')

onMounted(async () => {
  status.value = 'loading'
  try {
    if (!window.electronAPI?.ping) {
      throw new Error('electronAPI.ping is unavailable. Open this page inside Electron.')
    }
    ping.value = await window.electronAPI.ping()
    status.value = ping.value.ok ? 'ok' : 'error'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
})
</script>

<template>
  <main class="page">
    <header class="hero">
      <p class="eyebrow">工程基线 · Bootstrap</p>
      <h1>{{ APP_DISPLAY_NAME }}</h1>
      <p class="lead">
        Electron 主进程、Preload 安全桥与 Vue3 Renderer 最小连通页。素材库、Dexie、Manifest
        等业务不在本阶段实现。
      </p>
    </header>

    <section class="panel" aria-live="polite">
      <h2>主进程连通检查</h2>
      <p v-if="status === 'loading'">正在调用 <code>felt:bootstrap:ping</code>…</p>
      <p v-else-if="status === 'error'" class="error">
        连通失败：{{ errorMessage || 'unknown error' }}
      </p>
      <dl v-else-if="ping" class="grid">
        <div>
          <dt>状态</dt>
          <dd>{{ ping.ok ? 'OK' : 'FAILED' }}</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>{{ ping.appVersion }}</dd>
        </div>
        <div>
          <dt>Electron</dt>
          <dd>{{ ping.electronVersion }}</dd>
        </div>
        <div>
          <dt>平台</dt>
          <dd>{{ ping.platform }} / {{ ping.arch }}</dd>
        </div>
        <div class="wide">
          <dt>Windows 静态资源路径</dt>
          <dd><code>{{ ping.markerPath }}</code></dd>
        </div>
        <div class="wide">
          <dt>资源 file URL</dt>
          <dd><code>{{ ping.markerUrl }}</code></dd>
        </div>
        <div class="wide">
          <dt>时间戳</dt>
          <dd>{{ ping.timestamp }}</dd>
        </div>
      </dl>
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: light;
  --ink: #16302b;
  --muted: #4d6460;
  --paper: #eef4f2;
  --panel: #ffffff;
  --line: #c5d5d0;
  --accent: #1f6f63;
  --danger: #9b2c2c;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background:
    radial-gradient(circle at 12% 8%, rgba(31, 111, 99, 0.16), transparent 42%),
    linear-gradient(165deg, #e7f2ef 0%, var(--paper) 48%, #f7faf9 100%);
  color: var(--ink);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

.page {
  max-width: 920px;
  margin: 0 auto;
  padding: 48px 24px 64px;
}

.hero h1 {
  margin: 8px 0 12px;
  font-size: clamp(2rem, 4vw, 3rem);
  letter-spacing: 0.02em;
}

.eyebrow {
  margin: 0;
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.8rem;
}

.lead {
  margin: 0;
  max-width: 42rem;
  color: var(--muted);
  line-height: 1.6;
}

.panel {
  margin-top: 32px;
  padding: 24px;
  background: color-mix(in srgb, var(--panel) 92%, white);
  border: 1px solid var(--line);
}

.panel h2 {
  margin: 0 0 16px;
  font-size: 1.15rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  margin: 0;
}

.grid .wide {
  grid-column: 1 / -1;
}

dt {
  font-size: 0.8rem;
  color: var(--muted);
}

dd {
  margin: 4px 0 0;
  word-break: break-all;
}

code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.92em;
}

.error {
  color: var(--danger);
}

@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>

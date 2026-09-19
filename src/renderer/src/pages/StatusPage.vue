<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { APP_DISPLAY_NAME, type BootstrapPingResult } from '@shared/constants/app'
import type { ResourceInspectResult } from '@shared/resource'
import { inspectResource } from '../services/resource.service'
import { aiClient } from '../services/ai.client'

const MOCK_MATERIAL_REF = 'felt-resource://material/mock-sticker.png'

const status = ref<'idle' | 'loading' | 'ok' | 'error'>('idle')
const ping = ref<BootstrapPingResult | null>(null)
const resource = ref<ResourceInspectResult | null>(null)
const aiHealth = ref<string>('')
const errorMessage = ref('')

onMounted(async () => {
  status.value = 'loading'
  try {
    if (!window.electronAPI?.ping) {
      throw new Error('electronAPI.ping is unavailable. Open this page inside Electron.')
    }
    ping.value = await window.electronAPI.ping()
    resource.value = await inspectResource(MOCK_MATERIAL_REF)
    try {
      const health = await aiClient.health()
      aiHealth.value = JSON.stringify(health)
    } catch (error) {
      aiHealth.value = error instanceof Error ? error.message : String(error)
    }
    status.value = ping.value.ok ? 'ok' : 'error'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
})
</script>

<template>
  <section class="status-page">
    <header>
      <h2>{{ APP_DISPLAY_NAME }} · 运行状态</h2>
      <p>Bootstrap / felt-resource / AI health（不替代素材库联调页）</p>
    </header>

    <p v-if="status === 'loading'">检查中…</p>
    <p v-else-if="status === 'error'" class="error">{{ errorMessage }}</p>

    <dl v-if="ping" class="grid">
      <div><dt>ping</dt><dd>{{ ping.ok ? 'OK' : 'FAILED' }}</dd></div>
      <div><dt>version</dt><dd>{{ ping.appVersion }}</dd></div>
      <div><dt>electron</dt><dd>{{ ping.electronVersion }}</dd></div>
      <div><dt>platform</dt><dd>{{ ping.platform }} / {{ ping.arch }}</dd></div>
    </dl>

    <template v-if="resource?.ok">
      <p>
        资源 <code>{{ MOCK_MATERIAL_REF }}</code> · exists={{ resource.exists }}
      </p>
      <img :src="MOCK_MATERIAL_REF" alt="mock sticker" width="64" height="64" />
    </template>
    <p v-else-if="resource && !resource.ok" class="error">
      {{ resource.error.code }} — {{ resource.error.message }}
    </p>

    <p class="ai">AI health：<code>{{ aiHealth || '…' }}</code></p>
  </section>
</template>

<style scoped>
.status-page {
  display: grid;
  gap: 16px;
}

header h2 {
  margin: 0 0 6px;
}

header p,
.ai {
  margin: 0;
  color: var(--muted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}

dt {
  color: var(--muted);
  font-size: 0.8rem;
}

dd {
  margin: 4px 0 0;
}

.error {
  color: var(--danger);
}

img {
  border: 1px solid var(--line);
  background: #fff;
}

code {
  font-family: Consolas, "Courier New", monospace;
  word-break: break-all;
}
</style>

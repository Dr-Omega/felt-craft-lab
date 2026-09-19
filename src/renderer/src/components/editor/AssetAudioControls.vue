<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetRecord } from '@shared/contracts'
import { audioService } from '../../services/audio.service'

const props = defineProps<{
  asset: AssetRecord | null
  active: boolean
}>()

type AudioButton = {
  key: 'nameZhUrl' | 'nameEnUrl' | 'introZhUrl'
  url: string
  label: string
}

const playingUrl = ref<string | null>(null)

const audioButtons = computed<AudioButton[]>(() => {
  const audio = props.asset?.audio
  if (!audio) return []

  const buttons: AudioButton[] = []
  if (audio.nameZhUrl) buttons.push({ key: 'nameZhUrl', url: audio.nameZhUrl, label: '中文' })
  if (audio.nameEnUrl) buttons.push({ key: 'nameEnUrl', url: audio.nameEnUrl, label: 'English' })
  if (audio.introZhUrl) buttons.push({ key: 'introZhUrl', url: audio.introZhUrl, label: '介绍' })
  return buttons
})

watch(
  () => [props.asset?.assetId, props.active] as const,
  ([, active]) => {
    if (!active) playingUrl.value = null
  }
)

function playAudio(button: AudioButton): void {
  playingUrl.value = button.url
  void audioService.play(button.url, 'primary')
}
</script>

<template>
  <div v-if="audioButtons.length > 0" class="asset-audio-controls" aria-label="素材音频">
    <button
      v-for="button in audioButtons"
      :key="button.key"
      class="asset-audio-button"
      type="button"
      :class="{ 'is-playing': playingUrl === button.url }"
      :aria-label="playingUrl === button.url ? '正在播放' : button.label"
      @click="playAudio(button)"
    >
      <svg
        v-if="playingUrl === button.url"
        class="asset-audio-icon is-pulse"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 6.5h2.2L8.6 3.7v8.6L5.2 9.5H3z" fill="currentColor" />
        <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" />
        <path d="M12.5 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" />
      </svg>
      <svg
        v-else
        class="asset-audio-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 6.5h2.2L8.6 3.7v8.6L5.2 9.5H3z" fill="currentColor" />
        <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" />
      </svg>
      <span class="asset-audio-label">{{ playingUrl === button.url ? '播放中' : button.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.asset-audio-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.asset-audio-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--wood-mid, #d9b98a);
  border-radius: 999px;
  background: #fffef8;
  color: var(--color-text, #594738);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
}

.asset-audio-icon {
  width: 12px;
  height: 12px;
  color: var(--color-text-soft, #8b7355);
  flex: 0 0 auto;
}

.asset-audio-button:hover,
.asset-audio-button.is-playing {
  border-color: var(--color-primary, #e8a572);
  background: var(--color-primary-soft, #f4c9a4);
  color: var(--wood-deeper, #7e6244);
}

.asset-audio-button.is-playing .asset-audio-icon,
.asset-audio-button:hover .asset-audio-icon {
  color: var(--color-primary, #e8a572);
}

@keyframes asset-audio-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: 0.7; }
}

.asset-audio-icon.is-pulse {
  animation: asset-audio-pulse 1.1s ease-in-out infinite;
}
</style>

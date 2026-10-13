<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
  if (audio.nameZhUrl) buttons.push({ key: 'nameZhUrl', url: audio.nameZhUrl, label: '中文名称' })
  if (audio.nameEnUrl) buttons.push({ key: 'nameEnUrl', url: audio.nameEnUrl, label: '英文名称' })
  if (audio.introZhUrl) buttons.push({ key: 'introZhUrl', url: audio.introZhUrl, label: '听介绍' })
  return buttons
})

watch(
  () => [props.asset?.assetId, props.active] as const,
  () => stopOwnedAudio()
)

function stopOwnedAudio(): void {
  if (playingUrl.value) audioService.stop('primary')
  playingUrl.value = null
}

onBeforeUnmount(stopOwnedAudio)

function playAudio(button: AudioButton): void {
  if (!props.active) return
  playingUrl.value = button.url
  void audioService.play(button.url, 'primary')
}
</script>

<template>
  <div v-if="audioButtons.length > 0" class="asset-audio-controls" aria-label="素材音频">
    <button
      v-for="button in audioButtons"
      :key="button.key"
      class="asset-audio-button hand-btn-secondary"
      type="button"
      :class="{ 'is-playing': playingUrl === button.url }"
      :aria-label="playingUrl === button.url ? '正在播放' : button.label"
      @click="playAudio(button)"
    >
      {{ playingUrl === button.url ? '正在播放' : button.label }}
    </button>
  </div>
</template>

<style scoped>
.asset-audio-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.asset-audio-button {
  min-height: 40px;
  padding: 6px 16px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.asset-audio-button:hover,
.asset-audio-button.is-playing {
  filter: brightness(1.06);
}
</style>

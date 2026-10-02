<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { LayerColors } from '@shared/fabrication-colors'
import LayerColorPicker from './LayerColorPicker.vue'
import { placeLayerPanel, type ScreenBox } from '../../fabrication/panel-placement'
import panelArt from '../../../../../assets/ui/dismantle/panel-05.png'
import layerArt from '../../../../../assets/ui/dismantle/layer-06.png'

const props = defineProps<{
  anchor: ScreenBox; colors?: LayerColors; selected: number; images?: string[]; composite?: string
  saving?: boolean; dirty?: boolean; rendering?: boolean; message?: string; error?: string; saveLabel?: string
}>()
const emit = defineEmits<{
  select: [index: number]; color: [hex: string]; save: []; close: []; discard: []
}>()
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const placement = computed(() => placeLayerPanel(props.anchor, viewport.value))
const style = computed(() => Object.fromEntries(['left','top','width','height'].map(key =>
  [key, `${placement.value[key as 'left' | 'top' | 'width' | 'height']}px`])))
const selectedLayer = computed(() => props.colors?.layers[props.selected])
// Painting applications show the top layer first. Never mutate the canonical bottom-first array.
const displayLayers = computed(() => [...(props.colors?.layers || [])].reverse())
const panel = ref<HTMLElement>()
const confirmClose = ref(false)
let opener: HTMLElement | null = null
function resize(): void { viewport.value = { width: innerWidth, height: innerHeight } }
function close(): void {
  if (props.saving) return
  if (props.dirty) confirmClose.value = true
  else emit('close')
}
function keys(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.stopPropagation(); close() }
  if (event.key !== 'Tab') return
  const buttons = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') || [])]
  const first = buttons[0], last = buttons.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(async () => {
  opener = document.activeElement as HTMLElement
  window.addEventListener('resize', resize)
  await nextTick(); panel.value?.querySelector<HTMLButtonElement>('button')?.focus()
})
onUnmounted(() => { window.removeEventListener('resize', resize); if (opener?.isConnected) opener.focus() })
</script>

<template>
  <Teleport to="body">
    <div class="layer-edit-shield" @click.self="close">
      <section ref="panel" class="layer-edit-popup" role="dialog" aria-modal="true" aria-label="元素图层编辑"
        :data-side="placement.side" :style="style" @keydown="keys">
        <!-- Original full-canvas PNG remains untouched; viewBox is the measured painted bounds.
             The popup (unlike the page artwork) is intentionally movable per the user's rule. -->
        <svg class="panel-art" viewBox="1034 120 675 885" preserveAspectRatio="none" aria-hidden="true"><image :href="panelArt" width="1920" height="1080" /></svg>
        <header><div><h2>图层换色</h2><small>一层一起换，同色不同层不联动</small></div><button aria-label="关闭图层编辑" :disabled="saving" @click="close">×</button></header>
        <div class="panel-columns">
          <section class="layer-column" aria-label="制作图层列表">
            <p class="column-heading">图层 <small>上 → 下</small></p>
            <div class="layer-scroll" role="group" aria-label="选择制作层">
              <button v-for="layer in displayLayers" :key="layer.layerId" class="layer-row" :aria-pressed="selected === layer.layerIndex"
                :aria-label="`第 ${layer.layerIndex + 1} 层 · ${layer.pieceIds.length} 块`" :disabled="saving" @click="emit('select', layer.layerIndex)">
                <span class="layer-thumb"><svg viewBox="1092 201 247 221" aria-hidden="true"><image :href="layerArt" width="1920" height="1080" /></svg>
                  <img v-if="images?.[layer.layerIndex]" :src="images[layer.layerIndex]" alt="" />
                </span>
                <span>第 {{ layer.layerIndex + 1 }} 层 <b v-if="selected === layer.layerIndex">✓</b></span>
                <small>{{ layer.pieceIds.length }} 块 <i :style="{ background: layer.hex }" />{{ layer.hex }}</small>
              </button>
              <p v-if="!colors">等待真实分层结果…</p>
            </div>
          </section>
          <section class="color-column" aria-label="当前层调色">
            <LayerColorPicker v-if="selectedLayer" :model-value="selectedLayer.hex" :disabled="saving" @update:model-value="emit('color', $event)" />
            <p v-else>分层完成后，在这里使用色轮、RGB 和预设色盘。</p>
            <button v-if="selectedLayer" :disabled="saving" @click="emit('color', selectedLayer.originalHex)">恢复本层原色</button>
            <figure v-if="composite"><img :src="composite" alt="当前元素换色叠贴预览" /><figcaption>整体预览</figcaption></figure>
          </section>
        </div>
        <footer>
          <p role="status">{{ dirty ? '换色尚未保存' : message }}{{ rendering ? ' · 更新预览中' : '' }}</p>
          <p v-if="error" role="alert" class="panel-error">{{ error }}</p>
          <slot />
          <button v-if="colors" class="primary" :disabled="saving || !dirty || rendering" @click="emit('save')">{{ saving ? '保存中…' : (saveLabel || '保存换色') }}</button>
          <div v-if="confirmClose" class="close-confirm" role="alert">
            <p>本次换色还未保存。</p>
            <button @click="confirmClose = false">继续编辑</button>
            <button @click="emit('discard'); emit('close')">放弃本次换色并关闭</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.layer-edit-shield { position: fixed; inset: 0; z-index: 1000; background: transparent; }
.layer-edit-popup { position: fixed; isolation: isolate; display: flex; flex-direction: column; padding: 22px 24px; color: #652415; font-size: 13px; filter: drop-shadow(0 8px 12px #59362333); }
.panel-art { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }
header { display: flex; align-items: start; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
h2 { margin: 0 0 4px; font-size: 21px; } header button { font-size: 22px; padding: 0; width: 34px; height: 34px; }
.panel-columns { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1fr); gap: 18px; min-height: 0; flex: 1; }
.layer-column { display: flex; flex-direction: column; min-height: 0; } .column-heading { margin: 0 0 8px; font-weight: 700; } .column-heading small { font-weight: 400; }
.layer-scroll { overflow-y: auto; padding: 4px; min-height: 0; }
.layer-row { display: flex; flex-direction: column; align-items: center; width: 100%; padding: 5px; margin-bottom: 8px; background: transparent; border: 2px solid transparent; border-radius: 12px; gap: 4px; }
.layer-row[aria-pressed=true] { border-color: #652415; background: #fff4c4; } .layer-row small { display: flex; align-items: center; gap: 5px; font-size: 11px; }
.layer-row i { width: 12px; height: 12px; border: 1px solid #6c4230; }
.layer-thumb { position: relative; width: 100%; max-width: 92px; aspect-ratio: 247/221; }
.layer-thumb svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.layer-thumb img { position: absolute; inset: 9%; width: 82%; height: 82%; object-fit: contain; pointer-events: none; }
.color-column { overflow-y: auto; padding: 4px; min-width: 0; }
.color-column :deep(.picker) { border: 0; padding: 0; } .color-column :deep(legend) { font-weight: 700; padding: 0 0 8px; }
.color-column :deep(.wheel) { margin: 0 auto; width: 90px; height: 90px; } .color-column :deep(.wheel span) { width: 56px; height: 56px; }
.color-column :deep(.palette) { gap: 5px; } .color-column :deep(input[type=number]) { width: 100%; }
.color-column figure { margin: 10px 0 0; text-align: center; } .color-column figure img { width: 100%; height: 100px; object-fit: contain; background: #fff9e9; border-radius: 8px; }
footer { padding-top: 8px; flex-shrink: 0; } footer p { margin: 4px 0; overflow-wrap: anywhere; } .panel-error { color: #8c1616; }
.close-confirm { background: #fff8de; padding: 8px; border: 2px solid #652415; }
@media(max-width: 550px) { .layer-edit-popup { padding: 18px 16px; } .panel-columns { gap: 10px; } }
</style>

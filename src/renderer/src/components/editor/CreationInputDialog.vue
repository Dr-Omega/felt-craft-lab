<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { CreationIntentAccepted } from '@shared/creation-intent'
import type { ForegroundMode } from '@shared/fabrication-desktop'
import CreateAssetPage from '../../pages/CreateAssetPage.vue'
import { normalizeCanvasUpload } from '../../fabrication/canvas-intake'
import ArtworkButton from './ArtworkButton.vue'
import SourceArtboard from '../artwork/SourceArtboard.vue'
import { handDrawnAssets } from '../../ui/hand-drawn-assets'
import chooseArt from '../../../../../assets/ui/creation/choose.png'
import uploadArt from '../../../../../assets/ui/creation/upload.png'
import voiceArt from '../../../../../assets/ui/creation/voice.png'
import panelArt from '../../../../../assets/ui/creation/voice-panel.png'
const props = defineProps<{ insert: (bytes: Uint8Array, name: string, source: 'uploaded' | 'ai_generated', foregroundMode?: ForegroundMode) => Promise<void> }>()
const foregroundMode = ref<ForegroundMode>('birefnet-general')
const emit = defineEmits<{ close: [] }>()
const mode = ref<'choose'|'upload'|'voice'>('choose'), busy = ref(false), error = ref(''), preview = ref(''), filename = ref('')
const panel = ref<HTMLElement>(), input = ref<HTMLInputElement>()
let bytes: Uint8Array | undefined, generation = 0, disposed = false, opener: HTMLElement | null = null
function close(): void { if (!busy.value) emit('close') }
function keys(e: KeyboardEvent): void {
  if (e.key === 'Escape') { e.stopPropagation(); close() }
  if (e.key !== 'Tab') return
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),select:not(:disabled),input:not([hidden]):not(:disabled)') || [])]
  if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus() }
  else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus() }
}
async function selected(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
  const token = ++generation; error.value = ''; busy.value = true
  try {
    const normalized = await normalizeCanvasUpload(file)
    if (disposed || token !== generation) return
    if (preview.value) URL.revokeObjectURL(preview.value)
    bytes = normalized; filename.value = file.name
    foregroundMode.value = 'birefnet-general'
    preview.value = URL.createObjectURL(new Blob([new Uint8Array(normalized).buffer], {type:file.type})); mode.value = 'upload'
  } catch(e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false; if (input.value) input.value.value = '' }
}
async function useUpload(): Promise<void> {
  if (!bytes || busy.value) return
  busy.value = true; error.value = ''
  try { await props.insert(bytes, filename.value, 'uploaded', foregroundMode.value); emit('close') }
  catch(e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
async function useGenerated(accepted: CreationIntentAccepted): Promise<void> {
  busy.value = true
  try {
    const response = await fetch(accepted.sourceImageRef)
    if (!response.ok) throw new Error('生成图片未能读回，请重试。')
    await props.insert(new Uint8Array(await response.arrayBuffer()), accepted.name, 'ai_generated'); emit('close')
  } finally { busy.value = false }
}
onMounted(async () => { opener = document.activeElement as HTMLElement; await nextTick(); panel.value?.querySelector('button')?.focus() })
onUnmounted(() => { disposed = true; generation++; if (preview.value) URL.revokeObjectURL(preview.value); opener?.isConnected && opener.focus() })
</script>
<template>
  <Teleport to="body">
    <div class="intake-overlay" @click.self="close">
      <input ref="input" hidden type="file" accept="image/png,image/jpeg" aria-label="上传创作图片" @change="selected" />
      <SourceArtboard v-if="mode === 'choose'">
        <section ref="panel" role="dialog" aria-modal="true" aria-label="添加创作图片" class="intake-source-choices" @keydown="keys">
          <div class="intake-source-hit" aria-hidden="true"></div>
          <img class="intake-source-art" :src="chooseArt" alt="" />
          <button class="intake-source-close" aria-label="关闭添加图片" :disabled="busy" @click="close"><img :src="handDrawnAssets.btnClose" alt="" /></button>
          <ArtworkButton :image="uploadArt" bounds="700 529 523 99" label="直接上传图片" :disabled="busy" @click="input?.click()" />
          <ArtworkButton :image="voiceArt" bounds="700 647 523 98" label="语音输入生图" :disabled="busy" @click="mode='voice'" />
          <p v-if="error" class="intake-source-error" role="alert">{{ error }}</p>
        </section>
      </SourceArtboard>
      <SourceArtboard v-else>
      <section ref="panel" role="dialog" aria-modal="true" aria-label="添加创作图片" class="intake-panel art-scrollbars" :class="`is-${mode}`" @keydown="keys">
        <svg class="intake-art" viewBox="599 259 743 568" aria-hidden="true"><image :href="panelArt" width="1920" height="1080" /></svg>
        <button class="intake-close" aria-label="关闭添加图片" :disabled="busy" @click="close"><img :src="handDrawnAssets.btnClose" alt="" /></button>
        <template v-if="mode==='upload'">
          <h2>确认这张图片</h2><img class="upload-preview" :src="preview" alt="待加入画布的原始图片" />
          <p>{{ filename }} · PNG/JPEG，最多 10MB</p>
          <label>背景处理 <select v-model="foregroundMode" :disabled="busy" aria-label="背景处理">
            <option value="birefnet-general">自动去背景</option>
            <option value="embedded-alpha">图片已透明，保留现状</option>
          </select></label>
          <div class="intake-actions"><button :disabled="busy" @click="input?.click()">重新选择</button><button class="primary" :disabled="busy" @click="useUpload">确认图片并开始拆分</button></div>
        </template>
        <CreateAssetPage v-else :use-candidate="useGenerated" />
        <p v-if="busy" role="status">正在处理，请稍候…</p><p v-if="error" role="alert">{{ error }}</p>
      </section>
      </SourceArtboard>
    </div>
  </Teleport>
</template>
<style scoped>
.intake-source-choices { position: absolute; inset: 0; pointer-events: none; }
.intake-source-art { position: absolute; inset: 0; width: 1920px; height: 1080px; pointer-events: none; }
.intake-source-hit { position: absolute; left: 608px; top: 333px; width: 703px; height: 449px; pointer-events: auto; }
.intake-source-choices > .artwork-button { position: absolute; left: 700px; width: 523px; pointer-events: auto; }
.intake-source-choices > .artwork-button:nth-of-type(2) { top: 529px; height: 99px; }
.intake-source-choices > .artwork-button:nth-of-type(3) { top: 647px; height: 98px; }
.intake-source-close { position: absolute; left: 1260px; top: 349px; width: 40px; height: 40px; padding: 0; font-size: 28px; pointer-events: auto; }
.intake-source-error { position: absolute; left: 640px; top: 792px; width: 670px; font-size: 24px; pointer-events: auto; }
.intake-overlay { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; background: transparent; padding: 16px; }
.intake-panel { position: absolute; left: 599px; top: 259px; isolation: isolate; width: 743px; height: 568px; padding: 28px; color: #652415; overflow-y: auto; pointer-events: auto; }
.intake-panel.is-choose { aspect-ratio: 703/449; width: min(550px, 90vw); padding: 140px 64px 22px; }
.intake-panel.is-voice { padding: 0; overflow: visible; }
.intake-panel.is-voice :deep(.create-page) { max-width: none; }
.intake-art { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }
.intake-close { position: absolute; top: 12px; right: 14px; width: 32px; height: 32px; z-index: 2; }
.intake-close, .intake-source-close { padding: 0; border: 0; background: transparent; }
.intake-close img, .intake-source-close img { display: block; width: 100%; height: 100%; object-fit: contain; }
.intake-choices { display: grid; gap: 14px; }.intake-choices button { width: 100%; aspect-ratio: 523/99; }
.upload-preview { display: block; margin: auto; max-width: 100%; height: min(280px, 36vh); object-fit: contain; }
.intake-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
@media(max-height:700px) { .intake-panel.is-choose { padding-top: 125px; } }
</style>

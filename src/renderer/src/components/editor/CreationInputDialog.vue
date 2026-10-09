<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { CreationIntentAccepted } from '@shared/creation-intent'
import type { ForegroundMode } from '@shared/fabrication-desktop'
import CreateAssetPage from '../../pages/CreateAssetPage.vue'
import { normalizeCanvasUpload } from '../../fabrication/canvas-intake'
import ArtworkButton from './ArtworkButton.vue'
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
    preview.value = URL.createObjectURL(new Blob([new Uint8Array(normalized).buffer], {type:'image/png'})); mode.value = 'upload'
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
      <section ref="panel" role="dialog" aria-modal="true" aria-label="添加创作图片" class="intake-panel" :class="`is-${mode}`" @keydown="keys">
        <svg class="intake-art" :viewBox="mode==='choose' ? '608 333 703 449' : '599 259 743 568'" preserveAspectRatio="none" aria-hidden="true"><image :href="mode==='choose' ? chooseArt : panelArt" width="1920" height="1080" /></svg>
        <button class="intake-close" aria-label="关闭添加图片" :disabled="busy" @click="close">×</button>
        <input ref="input" hidden type="file" accept="image/png,image/jpeg" aria-label="上传创作图片" @change="selected" />
        <div v-if="mode==='choose'" class="intake-choices">
          <ArtworkButton :image="uploadArt" bounds="700 529 523 99" label="直接上传图片" :disabled="busy" @click="input?.click()" />
          <ArtworkButton :image="voiceArt" bounds="700 647 523 98" label="语音输入生图" :disabled="busy" @click="mode='voice'" />
        </div>
        <template v-else-if="mode==='upload'">
          <h2>确认这张图片</h2><img class="upload-preview" :src="preview" alt="待加入画布的原始图片" />
          <p>{{ filename }} · PNG/JPEG，最多 10MB</p>
          <p>确认后放入当前画布并准备图层；有背景的图片使用 BiRefNet General。</p>
          <label>前景来源 <select v-model="foregroundMode" :disabled="busy" aria-label="前景来源">
            <option value="birefnet-general">原图，需要去背景（BiRefNet General）</option>
            <option value="embedded-alpha">我确认已去背景，使用图片现有透明前景</option>
          </select></label>
          <div class="intake-actions"><button :disabled="busy" @click="input?.click()">重新选择</button><button class="primary" :disabled="busy" @click="useUpload">确认图片并开始拆分</button></div>
        </template>
        <CreateAssetPage v-else :use-candidate="useGenerated" />
        <p v-if="busy" role="status">正在处理，请稍候…</p><p v-if="error" role="alert">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.intake-overlay { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; background: transparent; padding: 16px; }
.intake-panel { position: relative; isolation: isolate; width: min(650px, 95vw); max-height: 90vh; padding: 28px; color: #652415; overflow-y: auto; }
.intake-panel.is-choose { aspect-ratio: 703/449; width: min(550px, 90vw); padding: 140px 64px 22px; }
.intake-panel.is-voice { height: min(760px, 90vh); padding-top: 42px; }
.intake-art { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }
.intake-close { position: absolute; top: 12px; right: 14px; font-size: 22px; }
.intake-choices { display: grid; gap: 14px; }.intake-choices button { width: 100%; aspect-ratio: 523/99; }
.upload-preview { display: block; margin: auto; max-width: 100%; height: min(280px, 36vh); object-fit: contain; }
.intake-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
@media(max-height:700px) { .intake-panel.is-choose { padding-top: 125px; } }
</style>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { ProvidedPsdEdit } from '@shared/provided-psd'
import type { LayerColors } from '@shared/fabrication-colors'
import { validHex } from '@shared/fabrication-colors'
import type { ScreenBox } from '../../fabrication/panel-placement'
import { paintProvidedPsd, psdLayerColors, checkedPsdEdit } from '../../projection/provided-psd-artwork'
import LayerEditorPanel from './LayerEditorPanel.vue'

const props = defineProps<{ edit: ProvidedPsdEdit; anchor: ScreenBox; apply: (png: string, edit: ProvidedPsdEdit) => Promise<void> }>()
const emit = defineEmits<{ preview: [png: string]; close: [] }>()
const colors = ref<LayerColors>(), selected = ref(0), dirty = ref(false), saving = ref(false), rendering = ref(false), error = ref('')
const painted = ref<Awaited<ReturnType<typeof paintProvidedPsd>>>()
let edit = checkedPsdEdit(props.edit), generation = 0, disposed = false
async function paint(preview: boolean) {
  const token = ++generation; rendering.value = true; error.value = ''; painted.value = undefined
  try {
    const next = await paintProvidedPsd(edit)
    if (!disposed && token === generation) { painted.value = next; if (preview) emit('preview', next.composite) }
  } catch (cause) { if (!disposed && token === generation) error.value = (cause as Error).message }
  finally { if (token === generation) rendering.value = false }
}
function changeColor(hex: string) {
  if (!colors.value || saving.value) return
  const next = validHex(hex)
  edit.colors[selected.value] = next; colors.value.layers[selected.value].hex = next
  dirty.value = true; void paint(true)
}
async function save() {
  if (!painted.value || saving.value || rendering.value) return
  saving.value = true; error.value = ''
  try {
    await props.apply(painted.value.composite, checkedPsdEdit(edit))
    if (!disposed) { dirty.value = false; emit('close') }
  } catch (cause) { if (!disposed) error.value = (cause as Error).message }
  finally { saving.value = false }
}
onMounted(async () => { colors.value = psdLayerColors(edit); await paint(false) })
onUnmounted(() => { disposed = true; generation++ })
</script>
<template>
  <LayerEditorPanel :anchor="anchor" :colors="colors" :selected="selected" :images="painted?.layers" :composite="painted?.composite"
    :saving="saving" :dirty="dirty" :rendering="rendering || !painted" :error="error" message="使用 PSD 原始图层，无需重新拆分。" save-label="应用到画布"
    @select="selected = $event" @color="changeColor" @save="save" @close="emit('close')" />
</template>

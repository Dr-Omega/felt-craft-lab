<script setup lang="ts">
import { ref, watch } from 'vue'
import { FavoriteStore, getFeltCraftDatabase } from '../../persistence'
import { getCurrentUserId } from '../../services/plaza-session'
const props = defineProps<{ assetId: string }>()
const selected = ref(false)
const busy = ref(false)
const error = ref('')
watch(() => props.assetId, async (id) => {
  error.value = ''; selected.value = false
  try {
    const row = await new FavoriteStore(getFeltCraftDatabase()).get(getCurrentUserId(), id)
    if (props.assetId === id) selected.value = !!row
  } catch { if (props.assetId === id) error.value = '收藏读取失败，请重试。' }
}, { immediate: true })
async function toggle(): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''
  const id = props.assetId, userId = getCurrentUserId()
  try {
    const store = new FavoriteStore(getFeltCraftDatabase())
    if (await store.get(userId, id)) await store.delete(userId, id)
    else await store.save({ userId, assetId: id, createdAt: new Date().toISOString() })
    const row = await store.get(userId, id)
    if (props.assetId === id) selected.value = !!row
  } catch { error.value = '收藏未保存，请重试。' }
  finally { busy.value = false }
}
</script>
<template>
  <button class="hand-btn-secondary" type="button" :aria-pressed="selected" :disabled="busy" @click="toggle">{{ selected ? '取消收藏' : '收藏' }}</button>
  <span v-if="error" role="alert">{{ error }}</span>
</template>

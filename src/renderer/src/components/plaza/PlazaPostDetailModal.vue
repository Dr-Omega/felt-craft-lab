<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import { friendlyShortDate } from '../../util/friendly-time'

const props = defineProps<{
  post: PlazaPost | null
  open: boolean
  previewSrc: string
}>()

const emit = defineEmits<{ close: [] }>()

const dialogEl = ref<HTMLDivElement | null>(null)

const title = computed(() => props.post?.title ?? '作品详情')
const meta = computed(() => {
  if (!props.post) return ''
  return `${props.post.authorName} · ${friendlyShortDate(props.post.createdAt)}`
})

function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', handleKey))
onUnmounted(() => window.removeEventListener('keydown', handleKey))

watch(
  () => props.open,
  (open) => {
    if (open) void Promise.resolve().then(() => dialogEl.value?.focus())
  }
)
</script>

<template>
  <button
    v-if="open && post"
    class="plaza-detail-backdrop"
    type="button"
    aria-label="关闭详情"
    @click="emit('close')"
  ></button>
  <div
    v-if="open && post"
    ref="dialogEl"
    class="plaza-detail-modal text-box-surface"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    tabindex="-1"
  >
    <header class="plaza-detail-head">
      <div>
        <h3>{{ title }}</h3>
        <p class="muted">{{ meta }}</p>
      </div>
      <button type="button" class="ghost" @click="emit('close')">关闭</button>
    </header>
    <div class="plaza-detail-preview">
      <img v-if="previewSrc" :src="previewSrc" :alt="title" />
      <p v-else class="muted">预览加载中…</p>
    </div>
  </div>
</template>

<style scoped>
.plaza-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 320;
  margin: 0;
  padding: 0;
  border: 0;
  background: rgba(40, 30, 20, 0.45);
  cursor: pointer;
}

.plaza-detail-modal {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 321;
  width: min(720px, 92vw);
  max-height: 88vh;
  padding: 20px 24px 24px;
  transform: translate(-50%, -50%);
  overflow: auto;
}

.plaza-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.plaza-detail-head h3 {
  margin: 0 0 6px;
}

.plaza-detail-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.35);
}

.plaza-detail-preview img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}
</style>

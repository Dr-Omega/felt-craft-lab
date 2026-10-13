<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ProjectRecord } from '@shared/contracts'
import { friendlyShortDate } from '../../util/friendly-time'

const props = defineProps<{
  project: ProjectRecord | null
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  open: [project: ProjectRecord]
}>()

const dialogEl = ref<HTMLDivElement | null>(null)
let opener: HTMLElement | null = null

const title = computed(() => props.project?.projectName ?? '作品预览')
const updatedLabel = computed(() => props.project ? `更新于 ${friendlyShortDate(props.project.updatedAt)}` : '')

function handleKey(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  if (event.key === 'Tab') {
    const buttons = [...(dialogEl.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === dialogEl.value)) { event.preventDefault(); buttons.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey)
})

watch(() => props.open, async (open) => {
  if (open) {
    opener = document.activeElement as HTMLElement
    await nextTick(); dialogEl.value?.focus()
  } else { await nextTick(); if (opener?.isConnected) opener.focus() }
})
</script>

<template>
  <Teleport to="body">
  <button
    v-if="open && project"
    class="project-preview-backdrop"
    type="button"
    aria-label="关闭作品预览"
    @click="emit('close')"
  ></button>
  <div
    v-if="open && project"
    ref="dialogEl"
    class="project-preview-modal"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    tabindex="-1"
  >
    <header class="project-preview-header">
      <div>
        <h3>{{ title }}</h3>
        <p class="project-preview-meta">{{ updatedLabel }}</p>
      </div>
      <button
        type="button"
        class="project-preview-close"
        aria-label="关闭作品预览"
        @click="emit('close')"
      >×</button>
    </header>
    <div class="project-preview-body">
      <img
        v-if="project.previewUrl"
        class="project-preview-image"
        :src="project.previewUrl"
        :alt="title"
      />
      <p v-else class="project-preview-empty">这件作品还没有缩略图</p>
    </div>
    <footer class="project-preview-actions">
      <slot name="feedback" />
      <slot name="actions" />
      <button type="button" class="ghost" @click="emit('close')">关闭</button>
      <button type="button" class="primary" @click="emit('open', project!)">打开作品</button>
    </footer>
  </div>
  </Teleport>
</template>

<style scoped>
.project-preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(89, 71, 56, 0.45);
  border: 0;
  padding: 0;
  z-index: 400;
  cursor: default;
}

.project-preview-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(92vw, 720px);
  max-height: min(86vh, 720px);
  background: var(--panel, #fff);
  border: 1px solid var(--line, #c5d5d0);
  border-radius: 24px;
  box-shadow: 0 16px 48px rgba(89, 71, 56, 0.28);
  display: grid;
  grid-template-rows: auto 1fr auto;
  z-index: 401;
  outline: none;
  overflow: hidden;
}

.project-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 24px 12px;
}

.project-preview-header h3 {
  margin: 0;
  font-size: 1.4rem;
}

.project-preview-meta {
  margin: 4px 0 0;
  color: var(--muted, #4d6460);
  font-size: 0.9rem;
}

.project-preview-close {
  appearance: none;
  border: 0;
  background: transparent;
  font-size: 1.6rem;
  line-height: 1;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--ink, #16302b);
  border-radius: 12px;
}

.project-preview-close:hover {
  background: rgba(89, 71, 56, 0.08);
}

.project-preview-body {
  padding: 0 24px 16px;
  display: grid;
  place-items: center;
  overflow: auto;
}

.project-preview-image {
  display: block;
  max-width: 100%;
  max-height: 56vh;
  object-fit: contain;
  background: var(--paper, #eef4f2);
  border-radius: 16px;
  border: 1px solid var(--line, #c5d5d0);
}

.project-preview-empty {
  margin: 0;
  color: var(--muted, #4d6460);
  text-align: center;
  font-size: 0.95rem;
}

.project-preview-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--line, #c5d5d0);
}
</style>

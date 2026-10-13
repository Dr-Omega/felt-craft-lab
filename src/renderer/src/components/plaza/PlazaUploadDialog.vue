<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  defaultTitle: string
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [title: string]
}>()

const title = ref('')

const canSubmit = computed(() => title.value.trim().length > 0 && !props.busy)

watch(
  () => [props.open, props.defaultTitle] as const,
  ([open, defaultTitle]) => {
    if (open) title.value = (defaultTitle || '').trim()
  }
)

function onCancel(): void {
  emit('close')
}

function onConfirm(): void {
  if (!canSubmit.value) return
  emit('confirm', title.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="plaza-upload-backdrop" role="presentation" @click.self="onCancel">
      <form class="plaza-upload-dialog text-box-surface" @submit.prevent="onConfirm" @click.stop>
        <h3>上传到分享广场</h3>
        <p class="muted">将公开预览图与作者信息。</p>
        <label class="plaza-upload-field">
          <span>作品标题</span>
          <input
            v-model="title"
            class="text-box-field"
            type="text"
            maxlength="80"
            :disabled="busy"
            autocomplete="off"
          />
        </label>
        <div class="plaza-upload-actions">
          <button type="button" class="ghost" :disabled="busy" @click="onCancel">取消</button>
          <button type="submit" class="primary" :disabled="!canSubmit">上传</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.plaza-upload-backdrop {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(40, 30, 20, 0.4);
  pointer-events: auto;
}

.plaza-upload-dialog {
  width: min(460px, 92vw);
  padding: 24px 26px;
  pointer-events: auto;
}

.plaza-upload-dialog h3 {
  margin: 0 0 8px;
}

.plaza-upload-field {
  display: grid;
  gap: 8px;
  margin: 16px 0 20px;
}

.plaza-upload-field input {
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
}

.plaza-upload-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

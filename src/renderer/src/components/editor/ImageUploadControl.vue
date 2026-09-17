<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  busy?: boolean
  fileName?: string
  previewUrl?: string
  status?: 'idle' | 'uploading' | 'success' | 'error'
}>()

const emit = defineEmits<{
  select: [file: File]
}>()

const input = ref<HTMLInputElement | null>(null)

function chooseImage(): void {
  input.value?.click()
}

function handleChange(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file) emit('select', file)
}
</script>

<template>
  <aside class="image-upload-control" aria-live="polite">
    <input
      ref="input"
      class="upload-input"
      type="file"
      accept="image/png,image/jpeg,image/bmp,.png,.jpg,.jpeg,.bmp"
      @change="handleChange"
    />
    <img v-if="previewUrl" class="upload-preview" :src="previewUrl" alt="已选择图片预览" />
    <button class="upload-button" type="button" :disabled="busy" @click="chooseImage">
      <span class="upload-icon" aria-hidden="true">▧</span>
      <span>{{ previewUrl ? '重新上传' : '上传图片' }}</span>
    </button>
    <p v-if="fileName" class="upload-name" :title="fileName">{{ fileName }}</p>
    <p v-if="status === 'uploading'" class="upload-status">正在上传...</p>
    <p v-else-if="status === 'success'" class="upload-status is-success">上传成功</p>
    <p v-else-if="status === 'error'" class="upload-status is-error">上传失败</p>
  </aside>
</template>

<style scoped>
.image-upload-control {
  position: absolute;
  top: 50%;
  right: 16px;
  z-index: 32;
  display: grid;
  justify-items: center;
  width: 132px;
  gap: 8px;
  transform: translateY(-50%);
}

.upload-input { display: none; }

.upload-preview {
  width: 112px;
  height: 112px;
  border: 3px solid #fffef8;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 4px 16px rgba(89, 71, 56, 0.18);
}

.upload-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 132px;
  min-height: 42px;
  gap: 7px;
  padding: 0 14px;
  border: 1px solid rgba(89, 71, 56, 0.16);
  border-radius: 8px;
  background: #fffef8;
  color: #594738;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(89, 71, 56, 0.1);
  cursor: pointer;
}

.upload-button:hover:not(:disabled) { background: #f4c9a4; }
.upload-button:disabled { cursor: not-allowed; opacity: 0.5; }
.upload-icon { font-size: 20px; line-height: 1; }
.upload-name { width: 132px; margin: 0; overflow: hidden; color: #8b7355; font-size: 11px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.upload-status { margin: 0; color: #8b7355; font-size: 12px; }
.upload-status.is-success { color: #577245; }
.upload-status.is-error { color: #9b3f32; }
</style>

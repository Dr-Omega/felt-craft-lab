<script setup lang="ts">
defineProps<{
  open: boolean
  busy?: boolean
  errorMessage?: string
}>()

const emit = defineEmits<{
  save: []
  discard: []
  cancel: []
}>()
</script>

<template>
  <div v-if="open" class="return-modal-layer" role="dialog" aria-modal="true" aria-labelledby="return-modal-title">
    <button class="return-modal-backdrop" type="button" aria-label="关闭返回提示" @click="emit('cancel')"></button>
    <section class="return-modal">
      <div class="return-modal-icon" aria-hidden="true">✿</div>
      <h2 id="return-modal-title">要先把作品收起来吗？</h2>
      <p>保存进度后，下次还可以接着做。</p>
      <p v-if="errorMessage" class="return-modal-error">{{ errorMessage }}</p>
      <div class="return-modal-actions">
        <button class="return-save" type="button" :disabled="busy" @click="emit('save')">保存进度再回去</button>
        <button class="return-discard" type="button" :disabled="busy" @click="emit('discard')">直接回去</button>
        <button class="return-cancel" type="button" :disabled="busy" @click="emit('cancel')">继续做</button>
      </div>
    </section>
  </div>
</template>

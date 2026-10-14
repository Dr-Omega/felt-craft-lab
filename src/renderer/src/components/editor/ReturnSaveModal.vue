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
  <Teleport to="body">
    <div
      v-if="open"
      class="return-modal-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-modal-title"
    >
      <button
        class="return-modal-backdrop"
        type="button"
        aria-label="关闭返回提示"
        @click="emit('cancel')"
      ></button>
      <section class="return-modal">
        <div class="return-modal-icon" aria-hidden="true">✿</div>
        <h2 id="return-modal-title">{{ errorMessage ? '进度还没保存成功' : '要先把作品收起来吗？' }}</h2>
        <p v-if="errorMessage" class="return-modal-error">{{ errorMessage }}</p>
        <div class="return-modal-actions">
          <button class="hand-btn-primary" type="button" :disabled="busy" @click="emit('save')">保存进度再回去</button>
          <button class="hand-btn-secondary" type="button" :disabled="busy" @click="emit('discard')">直接回去</button>
          <button class="hand-btn-secondary" type="button" :disabled="busy" @click="emit('cancel')">继续做</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.return-modal-layer {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  pointer-events: auto;
}

.return-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  border: 0;
  background: rgba(89, 71, 56, 0.32);
  cursor: pointer;
}

.return-modal {
  position: relative;
  z-index: 1;
  width: min(430px, calc(100vw - 48px));
  padding: 28px 24px 24px;
  text-align: center;
}

.return-modal-icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: var(--color-primary-soft, #f4c9a4);
  color: var(--wood-deeper, #7e6244);
  font-size: 28px;
}

.return-modal h2 {
  margin: 0;
  font-size: 20px;
  color: #594738;
}

.return-modal p {
  margin: 10px 0 0;
  color: var(--color-text-soft, #8b7355);
  font-size: 14px;
}

.return-modal-error {
  color: var(--wood-deeper, #7e6244) !important;
}

.return-modal-actions {
  display: grid;
  gap: 9px;
  margin-top: 22px;
}

.return-modal-actions button {
  width: 100%;
  cursor: pointer;
}

.return-modal-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

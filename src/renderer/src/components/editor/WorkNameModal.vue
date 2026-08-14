<script setup lang="ts">
import { ref, watch } from 'vue'
import { WORK_NAME_MAX_LENGTH } from '../../persistence/work-name'

const props = defineProps<{
  open: boolean
  initialName: string
  busy?: boolean
  errorMessage?: string
}>()

const emit = defineEmits<{
  save: [name: string]
  cancel: []
}>()

const name = ref(props.initialName)

watch(
  () => [props.open, props.initialName] as const,
  ([open, initialName]) => {
    if (open) name.value = initialName
  }
)
</script>

<template>
  <div v-if="open" class="return-modal-layer" role="dialog" aria-modal="true" aria-labelledby="work-name-modal-title">
    <button class="return-modal-backdrop" type="button" aria-label="关闭作品命名" @click="emit('cancel')"></button>
    <section class="return-modal work-name-modal">
      <div class="return-modal-icon" aria-hidden="true">✦</div>
      <h2 id="work-name-modal-title">给作品起个名字吧</h2>
      <p>不填也没关系，我们会帮你叫它“我的新作品”。</p>
      <label class="work-name-field">
        <span>作品名称</span>
        <input v-model="name" type="text" :maxlength="WORK_NAME_MAX_LENGTH" :disabled="busy" @keyup.enter="emit('save', name)" />
      </label>
      <p v-if="errorMessage" class="return-modal-error">{{ errorMessage }}</p>
      <div class="return-modal-actions">
        <button class="return-save" type="button" :disabled="busy" @click="emit('save', name)">完成作品</button>
        <button class="return-cancel" type="button" :disabled="busy" @click="emit('cancel')">再想想</button>
      </div>
    </section>
  </div>
</template>

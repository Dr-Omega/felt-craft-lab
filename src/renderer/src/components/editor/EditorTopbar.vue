<script setup lang="ts">
defineProps<{
  workName: string
  busy?: boolean
  canFinish?: boolean
}>()

const emit = defineEmits<{
  back: []
  finish: []
}>()
</script>

<template>
  <header class="editor-topbar">
    <button class="topbar-back" type="button" aria-label="返回素材库" @click="emit('back')">
      <span aria-hidden="true">←</span>
      <span>返回</span>
    </button>
    <h1 class="topbar-title">{{ workName }}</h1>
    <button
      class="topbar-finish"
      type="button"
      :disabled="busy || canFinish === false"
      @click="emit('finish')"
    >
      完成啦
    </button>
  </header>
</template>

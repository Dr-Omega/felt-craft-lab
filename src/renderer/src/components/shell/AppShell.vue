<script setup lang="ts">
import { computed } from 'vue'
import type { MainAppView } from '../../app-nav'
import { psd160Assets, psdBoxStyle } from '../../ui/psd160-assets'

defineProps<{
  activeView: MainAppView
}>()

const emit = defineEmits<{
  navigate: [view: MainAppView]
}>()

const foxStyle = computed(() => psdBoxStyle('fox-button'))
const whiteBearStyle = computed(() => psdBoxStyle('white-bear-button'))
const brownBearStyle = computed(() => psdBoxStyle('brown-bear-button'))
</script>

<template>
  <div class="psd-shell">
    <img class="psd-shell__background" :src="psd160Assets.background" alt="" aria-hidden="true" />

    <main class="psd-shell__content">
      <slot />
    </main>

    <!-- 前景装饰：叠在书本 / 画板 / 3D 投影屏之上，不拦截点击 -->
    <img class="psd-shell__decor" :src="psd160Assets.backgroundDecor" alt="" aria-hidden="true" />

    <nav class="psd-shell__nav" aria-label="页面导航">
      <button
        type="button"
        class="psd-shell__nav-btn"
        :class="{ 'is-active': activeView === 'library' }"
        :style="foxStyle"
        aria-label="书本 · 我的作品"
        @click="emit('navigate', 'library')"
      >
        <img :src="psd160Assets.foxButton" alt="" />
      </button>
      <button
        type="button"
        class="psd-shell__nav-btn"
        :class="{ 'is-active': activeView === 'editor' }"
        :style="whiteBearStyle"
        aria-label="画板 · 创作"
        @click="emit('navigate', 'editor')"
      >
        <img :src="psd160Assets.whiteBearButton" alt="" />
      </button>
      <button
        type="button"
        class="psd-shell__nav-btn"
        :class="{ 'is-active': activeView === 'projection' }"
        :style="brownBearStyle"
        aria-label="3D 投影屏"
        @click="emit('navigate', 'projection')"
      >
        <img :src="psd160Assets.brownBearButton" alt="" />
      </button>
    </nav>
  </div>
</template>

<style scoped>
.psd-shell {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #f8e8a8;
}

.psd-shell__background {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}

.psd-shell__decor {
  position: absolute;
  inset: 0;
  z-index: 20;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}

.psd-shell__content {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: visible;
}

.psd-shell__nav {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}

.psd-shell__nav-btn {
  position: absolute;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
  transition: transform 120ms ease, filter 120ms ease;
}

.psd-shell__nav-btn img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.psd-shell__nav-btn:hover {
  transform: scale(1.03);
  filter: brightness(1.04);
}

.psd-shell__nav-btn.is-active {
  filter: drop-shadow(0 0 10px rgba(232, 165, 114, 0.65));
}

.psd-shell__nav-btn:focus-visible {
  outline: 3px solid rgba(232, 165, 114, 0.85);
  outline-offset: 4px;
}
</style>

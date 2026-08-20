<script setup lang="ts">
import PsdFrameStage from '../components/shell/PsdFrameStage.vue'
</script>

<template>
  <section class="projection-page" aria-label="3D 投影屏">
    <PsdFrameStage frame="projection-screen">
      <div class="projection-viewport text-box-surface">
        <p class="projection-placeholder">3D 投影屏</p>
        <p class="projection-hint">这里以后会展示 3D 作品。</p>
      </div>
    </PsdFrameStage>
  </section>
</template>

<style scoped>
.projection-page {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

.projection-page :deep(.psd-frame-stage__content) {
  pointer-events: auto;
}

.projection-viewport {
  width: 100%;
  height: 100%;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  border-width: 0;
  background: rgba(245, 236, 216, 0.82);
  box-shadow: none;
}

.projection-placeholder {
  margin: 0;
  font-size: clamp(1.4rem, 2.4vw, 2rem);
  font-weight: 700;
  color: #594738;
}

.projection-hint {
  margin: 0;
  font-size: 0.95rem;
  color: #8b7355;
}
</style>

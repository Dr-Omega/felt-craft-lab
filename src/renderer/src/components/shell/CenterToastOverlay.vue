<script setup lang="ts">
import { centerToastMessage, centerToastVisible } from '../../composables/center-toast'
</script>

<template>
  <Transition name="center-toast-fade">
    <p v-if="centerToastVisible" class="center-toast" role="alert" aria-live="assertive">
      {{ centerToastMessage }}
    </p>
  </Transition>
</template>

<style scoped>
.center-toast {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 9999;
  max-width: min(720px, 88vw);
  margin: 0;
  padding: 22px 36px;
  transform: translate(-50%, -50%);
  border-radius: 16px;
  background: rgba(255, 252, 248, 0.94);
  box-shadow: 0 12px 40px rgba(60, 40, 20, 0.22);
  color: #b42318;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.45;
  text-align: center;
  pointer-events: none;
}

.center-toast-fade-enter-active,
.center-toast-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.center-toast-fade-enter-from,
.center-toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.96);
}
</style>

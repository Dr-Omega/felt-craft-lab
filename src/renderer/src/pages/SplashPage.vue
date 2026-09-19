<script setup lang="ts">
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import { authAssets, authFullLayerStyle } from '../ui/auth-assets'
import { openLogin } from '../app-nav'

function start(): void {
  openLogin()
}
</script>

<template>
  <button class="splash-screen" type="button" aria-label="点击屏幕任意处开始" @click="start">
    <AuthArtboard>
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.background" alt="" aria-hidden="true" />
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.splashDecor" alt="" aria-hidden="true" />
      <p class="splash-hint">点击屏幕任意处开始</p>
    </AuthArtboard>
  </button>
</template>

<style scoped>
.splash-screen {
  position: fixed;
  inset: 0;
  z-index: 200;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.auth-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}

.splash-hint {
  position: absolute;
  left: 960px;
  top: 920px;
  z-index: 2;
  margin: 0;
  padding: 16px 36px;
  border-radius: 999px;
  background: rgba(255, 254, 248, 0.88);
  color: #594738;
  font-size: 38px;
  letter-spacing: 2px;
  transform: translateX(-50%);
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(89, 71, 56, 0.14);
}
</style>

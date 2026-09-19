<script setup lang="ts">
import { ref } from 'vue'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import { completeLogin } from '../app-nav'
import { authAssets, authFullLayerStyle, authHitBoxStyle } from '../ui/auth-assets'

const username = ref('')
const password = ref('')

const nameFieldStyle = authHitBoxStyle('name-input')
const passwordFieldStyle = authHitBoxStyle('password-input')
const enterButtonStyle = authHitBoxStyle('login-enter-button')

function submit(): void {
  completeLogin()
}
</script>

<template>
  <AuthArtboard>
    <form class="login-form" @submit.prevent="submit">
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.background" alt="" aria-hidden="true" />
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.loginPanel" alt="" aria-hidden="true" />
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.nameInput" alt="" aria-hidden="true" />
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.passwordInput" alt="" aria-hidden="true" />
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.loginEnterButton" alt="" aria-hidden="true" />

      <label class="login-field" :style="nameFieldStyle">
        <input
          v-model="username"
          class="login-field-input"
          type="text"
          name="username"
          autocomplete="username"
          maxlength="40"
          aria-label="名字"
        />
      </label>

      <label class="login-field" :style="passwordFieldStyle">
        <input
          v-model="password"
          class="login-field-input"
          type="password"
          name="password"
          autocomplete="current-password"
          maxlength="64"
          aria-label="密码"
        />
      </label>

      <button class="login-enter-hit" type="submit" :style="enterButtonStyle" aria-label="进入" />
    </form>
  </AuthArtboard>
</template>

<style scoped>
.login-form {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0;
}

.auth-layer {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
}

.login-field {
  position: absolute;
  z-index: 2;
  display: block;
  margin: 0;
  padding: 0;
}

.login-field-input {
  position: absolute;
  left: 108px;
  right: 14px;
  top: 16px;
  bottom: 12px;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: #594738;
  font: inherit;
  font-size: 22px;
  outline: none;
}

.login-enter-hit {
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
</style>

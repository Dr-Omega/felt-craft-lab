<script setup lang="ts">
import { computed, ref } from 'vue'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import { completeLogin } from '../app-nav'
import { loginPlazaUser, registerPlazaUser } from '../services/plaza-api'
import { savePlazaSession } from '../services/plaza-session'
import { showCenterToast } from '../composables/center-toast'
import type { SharedError } from '@shared/contracts'
import { authAssets, authFullLayerStyle, authHitBoxStyle } from '../ui/auth-assets'

const username = ref('')
const password = ref('')
const mode = ref<'login' | 'register'>('login')
const busy = ref(false)
const PASSWORD_MIN = 3
const PASSWORD_MAX = 20

const nameFieldStyle = authHitBoxStyle('name-input')
const passwordFieldStyle = authHitBoxStyle('password-input')
const enterButtonStyle = authHitBoxStyle('login-enter-button')

const panelSrc = computed(() => (mode.value === 'register' ? authAssets.registerPanel : authAssets.loginPanel))

function toggleMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login'
}

function validatePasswordLength(password: string): boolean {
  const len = password.length
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) {
    showCenterToast('密码需为3到20位之间，请重新输入')
    return false
  }
  return true
}

function authErrorMessage(error: unknown): string {
  const shared = error as SharedError
  const msg = typeof shared?.message === 'string' ? shared.message.trim() : ''
  if (msg && !/无法连接 AI 服务|AI 网关/.test(msg)) return msg
  if (/分享广场|backend|8788/.test(msg)) return msg
  if (/无法连接 AI 服务|AI 网关/.test(msg)) return '分享广场服务未连接，请先启动 backend（8788 端口）。'
  if (msg) return msg
  return '刚刚遇到一点小问题，请稍后再试。'
}

async function submit(): Promise<void> {
  const name = username.value.trim()
  if (!name) return
  if (!validatePasswordLength(password.value)) return

  busy.value = true
  try {
    const auth =
      mode.value === 'register'
        ? await registerPlazaUser(name, password.value)
        : await loginPlazaUser(name, password.value)
    savePlazaSession({ token: auth.token, user: auth.user })
    completeLogin()
  } catch (error) {
    showCenterToast(authErrorMessage(error))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthArtboard>
    <form class="login-form" @submit.prevent="submit">
      <img class="auth-layer" :style="authFullLayerStyle" :src="authAssets.background" alt="" aria-hidden="true" />
      <img class="auth-layer" :style="authFullLayerStyle" :src="panelSrc" alt="" aria-hidden="true" />
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
          :disabled="busy"
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
          :disabled="busy"
        />
      </label>

      <button
        class="login-enter-hit"
        type="submit"
        :style="enterButtonStyle"
        :aria-label="mode === 'login' ? '进入' : '注册并进入'"
        :disabled="busy"
      />

      <button type="button" class="login-mode-toggle linkish" :disabled="busy" @click="toggleMode">
        {{ mode === 'login' ? '没有账号？注册' : '已有账号？登录' }}
      </button>
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

.login-mode-toggle {
  position: absolute;
  left: 720px;
  top: 828px;
  z-index: 3;
  font-size: 22px;
  padding: 8px 12px;
  background: rgba(255, 254, 248, 0.82);
  border-radius: 999px;
}

</style>

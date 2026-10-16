<script setup lang="ts">
import { computed, ref } from 'vue'
import AuthArtboard from '../components/auth/AuthArtboard.vue'
import RoleArtworkPicker from '../components/auth/RoleArtworkPicker.vue'
import { suppliedRoles } from '../ui/supplied-controls'
import { completeLogin } from '../app-nav'
import { loginPlazaUser, registerPlazaUser } from '../services/plaza-api'
import { savePlazaSession } from '../services/plaza-session'
import { maybeStartOnboardingAfterAuth } from '../services/onboarding-service'
import { showCenterToast } from '../composables/center-toast'
import type { SharedError } from '@shared/contracts'
import type { UserRole } from '@shared/contracts/rewards'
import { authAssets, authFullLayerStyle, authHitBoxStyle } from '../ui/auth-assets'

const username = ref('')
const password = ref('')
const mode = ref<'login' | 'register'>('login')
const busy = ref(false)
const role = ref<UserRole>('child')
const choosingRole = ref(false)
const roleLabel = computed(() => suppliedRoles.find(item => item.value === role.value)?.label)
const PASSWORD_MIN = 3
const PASSWORD_MAX = 20

const nameFieldStyle = authHitBoxStyle('name-input')
const passwordFieldStyle = authHitBoxStyle('password-input')
const enterButtonStyle = authHitBoxStyle('login-enter-button')

const panelSrc = computed(() => (mode.value === 'register' ? authAssets.registerPanel : authAssets.loginPanel))

function toggleMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  choosingRole.value = mode.value === 'register'
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
  if (/无法连接 AI 服务|AI 网关|backend|8788/.test(msg)) return '连接失败，请联系老师或稍后重试。'
  if (msg) return msg
  return '刚刚遇到一点小问题，请稍后再试。'
}

async function submit(): Promise<void> {
  if (choosingRole.value || busy.value) return
  const name = username.value.trim()
  if (!name) return
  if (!validatePasswordLength(password.value)) return

  busy.value = true
  try {
    const auth =
      mode.value === 'register'
        ? await registerPlazaUser(name, password.value, role.value)
        : await loginPlazaUser(name, password.value)
    savePlazaSession({ token: auth.token, user: auth.user })
    if (auth.dailyRewardGranted) showCenterToast('今日登录奖励已到账')
    const { syncWorkspace } = await import('../persistence/workspace-sync')
    await syncWorkspace()
    completeLogin()
    maybeStartOnboardingAfterAuth(auth.user)
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
      <RoleArtworkPicker v-if="choosingRole" :disabled="busy" @select="value => { role = value; choosingRole = false }" @cancel="choosingRole = false" />
      <template v-else>
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

      <button v-if="mode === 'register'" type="button" class="login-role" :disabled="busy" @click="choosingRole = true">账号身份：{{ roleLabel }}（更换）</button>
      </template>

      <button v-if="!choosingRole" type="button" class="login-mode-toggle hand-btn-secondary" :disabled="busy" @click="toggleMode">
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
  min-width: 250px;
  min-height: 58px;
  padding: 8px 22px;
}

.login-role {
  position: absolute;
  left: 780px;
  top: 664px;
  max-width: 381px;
  height: 32px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 6px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: 18px;
  text-decoration: underline;
}

.login-role select {
  min-width: 130px;
  border: 0;
  background: transparent;
  color: #594738;
  font: inherit;
}

</style>

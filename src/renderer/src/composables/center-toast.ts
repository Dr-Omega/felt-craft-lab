import { ref } from 'vue'

export const centerToastVisible = ref(false)
export const centerToastMessage = ref('')

let hideTimer: number | undefined

export function showCenterToast(message: string, durationMs = 3200): void {
  centerToastMessage.value = message
  centerToastVisible.value = true
  if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    centerToastVisible.value = false
  }, durationMs)
}

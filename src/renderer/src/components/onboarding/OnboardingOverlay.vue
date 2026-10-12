<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import mascotUrl from '../../assets/onboarding/guide-mascot.png'
import {
  advanceOnboardingAfterTargetClick,
  bindOnboardingNavRefresh,
  getOnboardingStep,
  getOnboardingStepIndex,
  isOnboardingActive,
  isOnboardingReplay,
  onboardingViewMatches,
  skipOnboardingTour,
  subscribeOnboarding
} from '../../services/onboarding-service'
import { ONBOARDING_STEPS } from '../../services/onboarding-steps'

const visible = ref(isOnboardingActive())
const stepIndex = ref(getOnboardingStepIndex())
const hole = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const targetReady = ref(false)
const bubbleStyle = ref<Record<string, string>>({})

const step = computed(() => getOnboardingStep())
const viewReady = computed(
  () => visible.value && Boolean(step.value) && onboardingViewMatches() && targetReady.value
)
const progressLabel = computed(() => {
  const total = ONBOARDING_STEPS.length
  const current = Math.min(stepIndex.value + 1, total)
  return `${current} / ${total}`
})

let resizeObserver: ResizeObserver | undefined
let targetClickCleanup: (() => void) | undefined
let navUnsub: (() => void) | undefined

function syncState(): void {
  visible.value = isOnboardingActive()
  stepIndex.value = getOnboardingStepIndex()
  queueMeasure()
}

function queueMeasure(): void {
  requestAnimationFrame(measureTarget)
}

function measureTarget(): void {
  targetClickCleanup?.()
  targetClickCleanup = undefined
  hole.value = null
  targetReady.value = false
  if (!visible.value || !step.value) return

  if (!onboardingViewMatches()) return

  const el = document.querySelector(step.value.targetSelector) as HTMLElement | null
  if (!el) return
  targetReady.value = true

  const pad = 10
  const rect = el.getBoundingClientRect()
  hole.value = {
    x: Math.max(0, rect.left - pad),
    y: Math.max(0, rect.top - pad),
    w: rect.width + pad * 2,
    h: rect.height + pad * 2
  }

  el.classList.add('onboarding-tour-target')
  el.style.position = el.style.position || 'relative'
  el.style.zIndex = '10001'

  const onTargetClick = (): void => {
    el.classList.remove('onboarding-tour-target')
    el.style.zIndex = ''
    advanceOnboardingAfterTargetClick()
  }
  el.addEventListener('click', onTargetClick, { once: true, capture: true })
  targetClickCleanup = () => {
    el.removeEventListener('click', onTargetClick, { capture: true })
    el.classList.remove('onboarding-tour-target')
    el.style.zIndex = ''
  }

  layoutBubble(rect)
}

function layoutBubble(targetRect: DOMRect): void {
  const s = step.value
  if (!s) return
  const margin = 16
  const bubbleWidth = 320
  let left = targetRect.right + margin
  let top = targetRect.top

  if (s.bubbleSide === 'left') {
    left = targetRect.left - bubbleWidth - margin
    top = targetRect.top
  } else if (s.bubbleSide === 'top') {
    left = targetRect.left
    top = targetRect.top - 180
  } else if (s.bubbleSide === 'bottom') {
    left = targetRect.left
    top = targetRect.bottom + margin
  } else {
    left = targetRect.right + margin
    top = targetRect.top
  }

  left = Math.min(Math.max(12, left), window.innerWidth - bubbleWidth - 12)
  top = Math.min(Math.max(12, top), window.innerHeight - 200)
  bubbleStyle.value = { left: `${left}px`, top: `${top}px`, width: `${bubbleWidth}px` }
}

const maskId = `onboarding-hole-${Math.random().toString(36).slice(2)}`

watch([visible, stepIndex, viewReady], () => queueMeasure())

let unsubOnboarding: (() => void) | undefined

onMounted(() => {
  unsubOnboarding = subscribeOnboarding(syncState)
  navUnsub = bindOnboardingNavRefresh()
  window.addEventListener('resize', queueMeasure)
  resizeObserver = new ResizeObserver(queueMeasure)
  resizeObserver.observe(document.body)
  syncState()
})

onUnmounted(() => {
  unsubOnboarding?.()
  navUnsub?.()
  window.removeEventListener('resize', queueMeasure)
  resizeObserver?.disconnect()
  targetClickCleanup?.()
})

async function onSkipAll(): Promise<void> {
  await skipOnboardingTour()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && step" class="onboarding-root" aria-live="polite">
      <svg v-if="viewReady && hole" class="onboarding-mask" aria-hidden="true">
        <defs>
          <mask :id="maskId">
            <rect width="100%" height="100%" fill="white" />
            <rect :x="hole.x" :y="hole.y" :width="hole.w" :height="hole.h" rx="14" ry="14" fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.62)" :mask="`url(#${maskId})`" />
      </svg>

      <div v-else class="onboarding-wait-scrim" aria-hidden="true" />

      <div class="onboarding-panel" :class="{ 'is-waiting': !viewReady }" :style="viewReady ? bubbleStyle : undefined">
        <img class="onboarding-mascot" :src="mascotUrl" alt="" aria-hidden="true" />
        <div class="onboarding-copy">
          <p class="onboarding-progress">{{ progressLabel }}</p>
          <h2 class="onboarding-title">{{ viewReady ? step.title : '等等我哦' }}</h2>
          <p class="onboarding-body">{{ viewReady ? step.body : step.waitingHint }}</p>
          <div v-if="stepIndex === 0 && !isOnboardingReplay()" class="onboarding-actions">
            <button type="button" class="onboarding-skip" @click="onSkipAll">暂时不要，跳过全部</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-root {
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: none;
}

.onboarding-mask,
.onboarding-wait-scrim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.onboarding-wait-scrim {
  background: rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.onboarding-panel {
  position: fixed;
  z-index: 10002;
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding: 16px 18px;
  border: 3px solid #71351c;
  border-radius: 18px;
  background: rgba(255, 248, 213, 0.96);
  color: #513018;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
}

.onboarding-panel.is-waiting {
  left: 50% !important;
  bottom: 48px !important;
  top: auto !important;
  transform: translateX(-50%);
  width: min(520px, calc(100vw - 32px)) !important;
}

.onboarding-mascot {
  width: 96px;
  height: auto;
  flex: 0 0 96px;
  object-fit: contain;
  filter: drop-shadow(0 4px 0 rgba(113, 53, 28, 0.15));
}

.onboarding-progress {
  margin: 0 0 4px;
  font-size: 14px;
  opacity: 0.75;
}

.onboarding-title {
  margin: 0 0 6px;
  font-size: 22px;
}

.onboarding-body {
  margin: 0;
  font-size: 17px;
  line-height: 1.45;
}

.onboarding-actions {
  margin-top: 12px;
}

.onboarding-skip {
  border: 2px solid #71351c;
  border-radius: 999px;
  background: #fff4bd;
  color: #71351c;
  font-size: 15px;
  padding: 6px 14px;
  cursor: pointer;
}

:global(.onboarding-tour-target) {
  outline: 3px solid #ffe566;
  outline-offset: 3px;
}
</style>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import { openEditor } from '../app-nav'
import { createSceneWithCorePattern } from '../catalog/ywn-catalog'
import { CreationIntentController } from '../services/creation-intent.controller'
import { aiClient } from '../services/ai.client'
import { blobToBase64, MicRecorder, parseAsrEnvelope } from '../services/voice-input'

const GUIDE_STORAGE_KEY = 'felt-create-guide-dismissed'
const GUIDE_STEPS = [
  '先说想画什么，或按「开始说话」。',
  '看下面的方案卡。缺的一栏会问你，也可以点「你来定」。',
  '点「就这样画」看图。喜欢就去编辑器装饰，不喜欢就再画一张。'
] as const

const controller = reactive(new CreationIntentController())
const recorder = new MicRecorder()
const recording = ref(false)
const transcribing = ref(false)
const guideOpen = ref(typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(GUIDE_STORAGE_KEY) !== '1' : true)
const guideStep = ref(0)
const canConfirm = computed(() => controller.phase === 'ready_to_confirm')
const canDecideForMe = computed(() => controller.phase === 'awaiting_clarification')
const compiled = computed(
  () =>
    controller.phase === 'compiled' ||
    controller.phase === 'generated' ||
    controller.phase === 'accepted'
)
const qualityHeadline = computed(() => {
  const verdict = controller.quality?.verdict
  if (verdict === 'FAIL') return '制作时可能不太好剪，仍可以先做成作品'
  if (verdict === 'WARN') return '能用，制作时要注意'
  if (verdict === 'PASS') return '看起来适合做成不织布'
  return ''
})
const voiceBusy = computed(() => recording.value || transcribing.value || controller.busy)

onUnmounted(() => {
  recorder.cancel()
})

function dismissGuide(): void {
  guideOpen.value = false
  try {
    sessionStorage.setItem(GUIDE_STORAGE_KEY, '1')
  } catch {
    // ignore storage errors in restricted environments
  }
}

function nextGuideStep(): void {
  if (guideStep.value >= GUIDE_STEPS.length - 1) {
    dismissGuide()
    return
  }
  guideStep.value += 1
}

function reopenGuide(): void {
  guideStep.value = 0
  guideOpen.value = true
}

async function toggleVoice(): Promise<void> {
  if (compiled.value || transcribing.value || controller.busy) return
  controller.error = null
  controller.retryAction = null
  if (!recording.value) {
    try {
      await recorder.start()
      recording.value = true
    } catch (error) {
      controller.error = error instanceof Error ? error.message : '打不开麦克风，请允许后重试。'
    }
    return
  }

  recording.value = false
  transcribing.value = true
  try {
    const captured = await recorder.stop()
    const audioBase64 = await blobToBase64(captured.blob)
    const parsed = parseAsrEnvelope(
      await aiClient.asrTranscribe({
        audioBase64,
        mimeType: captured.mimeType || 'audio/webm',
        language: 'zh'
      })
    )
    if (!parsed.ok) {
      controller.error = parsed.message
      return
    }
    await controller.acceptUtterance(parsed.transcript)
  } catch (error) {
    controller.error = error instanceof Error ? error.message : '语音识别暂时无法完成，请稍后重试。'
  } finally {
    transcribing.value = false
  }
}

function resetAll(): void {
  recorder.cancel()
  recording.value = false
  transcribing.value = false
  controller.reset()
}

async function startWork(): Promise<void> {
  await controller.acceptCandidate()
  if (!controller.accepted) return
  openEditor({
    mode: 'new',
    fromGeneration: true,
    scene: createSceneWithCorePattern({
      workName: controller.accepted.name,
      personalAssetId: controller.accepted.personalAssetId,
      versionId: controller.accepted.versionId
    })
  })
}
</script>

<template>
  <section class="create-page">
    <div class="create-scroll">
      <header class="section-head">
        <div>
          <h2>生成作品</h2>
          <p class="muted">先画出核心图案。看过图后，点去编辑器装饰，再用贴纸和背景打扮它。</p>
        </div>
        <button v-if="!guideOpen" type="button" class="ghost guide-reopen" @click="reopenGuide">怎么用</button>
      </header>

      <aside v-if="guideOpen && !compiled" class="guide-card" data-testid="create-guide">
        <p class="guide-step">第 {{ guideStep + 1 }} / {{ GUIDE_STEPS.length }} 步</p>
        <p class="guide-text">{{ GUIDE_STEPS[guideStep] }}</p>
        <div class="guide-actions">
          <button type="button" class="ghost" @click="dismissGuide">跳过</button>
          <button type="button" class="primary" @click="nextGuideStep">
            {{ guideStep >= GUIDE_STEPS.length - 1 ? '知道了' : '下一步' }}
          </button>
        </div>
      </aside>

      <div class="create-panel">
        <label v-if="!compiled" class="say-box">
          {{ controller.question || (controller.hasPlan ? '再补一句' : '想画什么') }}
          <textarea
            v-model="controller.text"
            rows="3"
            maxlength="120"
            :disabled="voiceBusy"
            :placeholder="
              controller.question
                ? '回答这一句，或点下面的选项'
                : controller.hasPlan
                  ? '再说一句要补的，比如：坐在地上 / 红色皮球'
                  : '按开始说话，或输入：黑白熊猫抱着红色皮球，不要真实毛发'
            "
          />
        </label>

        <div v-if="controller.choices.length && !compiled" class="choices">
          <button
            v-for="choice in controller.choices"
            :key="choice"
            type="button"
            :disabled="voiceBusy"
            @click="controller.acceptUtterance(choice)"
          >
            {{ choice }}
          </button>
        </div>

        <p v-if="recording" class="summary waiting">正在听，说完再按一次。</p>
        <p v-else-if="transcribing" class="summary waiting">正在把你说的写成字…</p>
        <p v-else-if="controller.busyHint" class="summary waiting">{{ controller.busyHint }}</p>
        <p v-else-if="controller.busy" class="summary waiting">请稍等…</p>

        <div v-if="controller.showPlanCard && !compiled" class="plan-card">
          <h3>现在记下的方案</h3>
          <dl class="plan-fields">
            <div
              v-for="field in controller.plan.fields"
              :key="field.key"
              class="plan-row"
              :data-status="field.status"
            >
              <dt>{{ field.label }}</dt>
              <dd>
                <template v-if="field.value">{{ field.value }}</template>
                <span v-else class="empty">还没说</span>
                <span v-if="field.status === 'pending'" class="pending-tag">正在问这栏</span>
              </dd>
            </div>
          </dl>
          <p v-if="controller.question" class="muted">还缺一点，请先回答上面那句。</p>
          <p v-else class="muted">可以再补一句（颜色、必须有、场景、不要…），或点「就这样画」。</p>
        </div>

        <div v-if="controller.error" class="error-box">
          <p class="error">{{ controller.error }}</p>
          <button
            v-if="controller.canRetry"
            type="button"
            class="primary"
            :disabled="voiceBusy"
            @click="controller.retryLastFailure()"
          >
            再试一次
          </button>
        </div>

        <div v-if="compiled" class="preview-block">
          <h3>临时预览</h3>
          <p v-if="!controller.accepted" class="muted">
            喜欢这张就去编辑器装饰；不喜欢就再画一张，方案还在。
          </p>
          <img
            v-if="controller.candidateRef"
            class="candidate-image"
            :src="controller.candidateRef"
            alt="生成的核心图案预览"
          />
          <p v-else class="muted">图还没写好，请再试一次。</p>
          <div
            v-if="controller.quality"
            class="quality"
            :data-verdict="controller.quality.verdict"
          >
            <p class="quality-headline">{{ qualityHeadline }}</p>
            <p v-for="message in controller.quality.messages" :key="message" class="muted">
              {{ message }}
            </p>
            <p v-if="controller.quality.verdict === 'FAIL'" class="muted">
              这只是提醒，仍可以点「去编辑器装饰」。
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="actions">
      <button
        v-if="!compiled"
        type="button"
        :class="{ primary: recording }"
        :disabled="transcribing || controller.busy"
        @click="toggleVoice"
      >
        {{ recording ? '说完了' : '开始说话' }}
      </button>
      <button
        v-if="!compiled"
        type="button"
        class="primary"
        :disabled="voiceBusy"
        @click="controller.submitCurrentText()"
      >
        {{ controller.hasPlan ? '再补一句' : '用这句话' }}
      </button>
      <button
        v-if="canDecideForMe"
        type="button"
        :disabled="voiceBusy"
        @click="controller.decideForMe()"
      >
        你来定
      </button>
      <button
        v-if="canConfirm"
        type="button"
        class="primary"
        :disabled="voiceBusy"
        @click="controller.confirmPlan()"
      >
        就这样画
      </button>
      <button
        v-if="compiled && controller.candidateRef"
        type="button"
        class="primary"
        :disabled="controller.busy"
        @click="startWork"
      >
        去编辑器装饰
      </button>
      <button
        v-if="compiled"
        type="button"
        class="ghost"
        :disabled="controller.busy"
        @click="controller.redrawCandidate()"
      >
        再画一张
      </button>
      <button v-if="compiled" type="button" class="ghost" :disabled="controller.busy" @click="resetAll">
        重新说
      </button>
    </div>
  </section>
</template>

<style scoped>
.create-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 640px;
  height: 100%;
  min-height: 0;
}

.create-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: scroll;
  padding: 0 8px 8px 0;
}

.create-scroll::-webkit-scrollbar {
  width: 10px;
}

.create-scroll::-webkit-scrollbar-thumb {
  background: #9bb8b2;
  border-radius: 8px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-head h2 {
  margin: 0 0 6px;
  font-size: 1.6rem;
}

.guide-reopen {
  flex: 0 0 auto;
}

.guide-card {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  background: #eef6f4;
}

.guide-step {
  margin: 0;
  font-size: 0.9rem;
  color: #3f8579;
}

.guide-text {
  margin: 0;
  line-height: 1.55;
  font-size: 1.05rem;
}

.guide-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.muted,
.error {
  margin: 0;
  line-height: 1.5;
}

.muted {
  color: var(--muted);
}

.error {
  color: var(--danger);
}

.create-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
  background: var(--panel);
  border: 1px solid var(--line);
}

.say-box {
  display: grid;
  gap: 8px;
}

textarea {
  width: 100%;
  resize: vertical;
  min-height: 88px;
  padding: 10px 12px;
  font: inherit;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
}

.summary {
  margin: 0;
  line-height: 1.55;
}

.summary.waiting {
  padding: 8px 10px;
  border-radius: 6px;
  background: #eef6f4;
  animation: wait-pulse 1.4s ease-in-out infinite;
}

@keyframes wait-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.65;
  }
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plan-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  background: #f7fbfa;
}

.plan-card h3 {
  margin: 0;
  font-size: 1rem;
}

.plan-fields {
  display: grid;
  gap: 6px;
  margin: 0;
}

.plan-row {
  display: grid;
  grid-template-columns: 4.5em 1fr;
  gap: 8px;
  align-items: start;
  padding: 6px 8px;
  border-radius: 6px;
}

.plan-row[data-status='pending'] {
  background: #eef6f4;
  outline: 1px solid #9bb8b2;
}

.plan-row dt {
  margin: 0;
  font-weight: 600;
  color: var(--ink);
}

.plan-row dd {
  margin: 0;
  line-height: 1.55;
}

.plan-row .empty {
  color: var(--muted);
}

.plan-row .pending-tag {
  display: inline-block;
  margin-left: 8px;
  font-size: 0.85em;
  color: #3f8579;
}

.plan-card p {
  margin: 0;
  line-height: 1.55;
}

.error-box {
  display: grid;
  gap: 8px;
  justify-items: start;
}

.preview-block p {
  margin: 0;
  line-height: 1.55;
}

.preview-block h3 {
  margin: 8px 0 0;
  font-size: 1rem;
}

.candidate-image {
  display: block;
  width: min(100%, 220px);
  max-height: 160px;
  height: auto;
  object-fit: contain;
  border: 1px solid var(--line);
  background: #fff;
}

.quality {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f7fbfa;
}

.quality[data-verdict='WARN'] {
  background: #fff8eb;
}

.quality[data-verdict='FAIL'] {
  background: #fff4ef;
}

.quality-headline {
  margin: 0;
  line-height: 1.5;
  font-weight: 600;
}

.quality[data-verdict='FAIL'] .quality-headline {
  color: #a65b3a;
}

.actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 4px 4px;
  border-top: 1px solid var(--line);
  background: var(--paper);
}
</style>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import { openEditor } from '../app-nav'
import { createSceneWithCorePattern } from '../catalog/ywn-catalog'
import { CreationIntentController } from '../services/creation-intent.controller'
import { aiClient } from '../services/ai.client'
import { blobToBase64, MicRecorder, parseAsrEnvelope } from '../services/voice-input'
import type { CreationIntentAccepted } from '@shared/creation-intent'
import ArtworkButton from '../components/editor/ArtworkButton.vue'
import recordStart from '../../../../assets/ui/creation/record-start.png'
import recordPause from '../../../../assets/ui/creation/record-pause.png'
import recordResume from '../../../../assets/ui/creation/record-resume.png'
import recordDone from '../../../../assets/ui/creation/record-done.png'
import recordReset from '../../../../assets/ui/creation/record-reset.png'

const props = defineProps<{ useCandidate?: (accepted: CreationIntentAccepted) => Promise<void> }>()
const paused = ref(false), startingMic = ref(false), placing = ref(false)
let voiceTimer: ReturnType<typeof setTimeout> | undefined, disposed = false

const GUIDE_STORAGE_KEY = 'felt-create-guide-dismissed'
const GUIDE_STEPS = [
  '先说想画什么，或按「开始录音」。',
  '看下面的方案卡。缺的一栏会问你，也可以点「你来定」。',
  props.useCandidate ? '点「就这样画」看图。确认后加入当前画布并拆分，不喜欢就再画一张。' : '点「就这样画」看图。喜欢就去编辑器装饰，不喜欢就再画一张。'
] as const

const controller = reactive(new CreationIntentController())
const recorder = new MicRecorder()
const recording = ref(false)
const transcribing = ref(false)
const guideOpen = ref(typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(GUIDE_STORAGE_KEY) !== '1' : true)
const guideStep = ref(0)
/** ASR/mic failure on this page — offer「再说一次」separate from intent retry. */
const voiceRetry = ref(false)
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
const voiceBusy = computed(() => recording.value || startingMic.value || transcribing.value || controller.busy || placing.value)

onUnmounted(() => {
  disposed = true; clearTimeout(voiceTimer)
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

async function retryVoice(): Promise<void> {
  voiceRetry.value = false
  controller.error = null
  if (!recording.value && !transcribing.value) {
    await toggleVoice()
  }
}

async function toggleVoice(): Promise<void> {
  if (compiled.value || startingMic.value || transcribing.value || controller.busy) return
  controller.error = null
  controller.retryAction = null
  voiceRetry.value = false
  if (!recording.value) {
    startingMic.value = true
    try {
      await recorder.start()
      if (disposed) return
      recording.value = true
      paused.value = false
      voiceTimer = setTimeout(() => { if (recording.value) void toggleVoice() }, 60_000)
    } catch (error) {
      controller.error = error instanceof Error ? error.message : '打不开麦克风。请允许使用麦克风，或先在上面打字。'
      voiceRetry.value = true
    } finally { startingMic.value = false }
    return
  }

  recording.value = false
  paused.value = false; clearTimeout(voiceTimer)
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
      voiceRetry.value = parsed.reason === 'empty' || parsed.reason === 'network' || parsed.reason === 'unknown'
      return
    }
    if (!disposed) await controller.acceptUtterance(parsed.transcript)
  } catch (error) {
    controller.error =
      error instanceof Error ? error.message : '语音识别暂时用不了。请稍后再试，或先在上面打字。'
    voiceRetry.value = true
  } finally {
    transcribing.value = false
  }
}

function resetAll(): void {
  clearTimeout(voiceTimer); paused.value = false
  recorder.cancel()
  recording.value = false
  transcribing.value = false
  voiceRetry.value = false
  controller.reset()
}

async function startWork(): Promise<void> {
  if (placing.value) return
  placing.value = true
  try {
    if (!controller.accepted) await controller.acceptCandidate()
    if (!controller.accepted) return
    if (props.useCandidate) {
      await props.useCandidate(controller.accepted)
      return
    }
    openEditor({
    mode: 'new',
    fromGeneration: true,
    scene: createSceneWithCorePattern({
      workName: controller.accepted.name,
      personalAssetId: controller.accepted.personalAssetId,
      versionId: controller.accepted.versionId
    })
    })
  } catch (e) { controller.error = e instanceof Error ? e.message : String(e) }
  finally { placing.value = false }
}

function pauseVoice(): void { if (paused.value) recorder.resume(); else recorder.pause(); paused.value = !paused.value }
async function restartVoice(): Promise<void> { recorder.cancel(); clearTimeout(voiceTimer); recording.value = false; paused.value = false; await toggleVoice() }
</script>

<template>
  <section class="create-page">
    <div class="create-scroll">
      <header class="section-head">
        <div>
          <h2>生成作品</h2>
          <p class="muted">{{ useCandidate ? '说出想画的内容，确认图片后加入当前画布并准备图层。也可以打字。' : '先画出核心图案。确认后去编辑器装饰，同时自动开始拆分；等待时也能布置贴纸和背景。' }}</p>
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

        <p v-if="recording" class="summary waiting">{{ paused ? '录音已暂停。' : '正在录音，最长60秒；说完请点完成录音。' }}</p>
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

        <div v-if="controller.error" class="error-box" data-testid="create-error">
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
          <button
            v-else-if="voiceRetry && !compiled"
            type="button"
            class="primary"
            data-testid="voice-retry"
            :disabled="voiceBusy"
            @click="retryVoice()"
          >
            再说一次
          </button>
        </div>

        <div v-if="compiled" class="preview-block">
          <h3>临时预览</h3>
          <p v-if="!controller.accepted" class="muted">
            确认这张图后立即开始拆分，并进入画布继续创作；不喜欢就再画一张，方案还在。
          </p>
          <div v-if="controller.candidateRef" class="candidate-stage" data-testid="candidate-stage">
            <img
              class="candidate-image"
              :src="controller.candidateRef"
              alt="生成的核心图案预览"
            />
          </div>
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
              这只是提醒，仍可以点「确认图片并开始拆分」。
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="actions">
      <div v-if="!compiled" class="record-controls">
        <ArtworkButton v-if="!recording" :image="recordStart" bounds="768 566 385 140" label="开始录音" :disabled="voiceBusy" @click="toggleVoice" />
        <template v-else>
          <ArtworkButton :image="paused ? recordResume : recordPause" bounds="604 540 233 219" :label="paused ? '继续录音' : '暂停录音'" @click="pauseVoice" />
          <ArtworkButton :image="recordDone" bounds="844 540 233 219" label="完成录音" @click="toggleVoice" />
          <ArtworkButton :image="recordReset" bounds="1090 540 233 219" label="重新录音" @click="restartVoice" />
        </template>
      </div>
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
        :disabled="controller.busy || placing"
        @click="startWork"
      >
        {{ useCandidate ? '使用这张图并开始拆分' : '确认图片并开始拆分' }}
      </button>
      <button
        v-if="compiled"
        type="button"
        class="ghost"
        :disabled="controller.busy || placing"
        @click="controller.redrawCandidate()"
      >
        再画一张
      </button>
      <button v-if="compiled" type="button" class="ghost" :disabled="controller.busy || placing" @click="resetAll">
        重新说
      </button>
    </div>
  </section>
</template>

<style scoped>
.record-controls { display: flex; gap: 8px; align-items: center; }
.record-controls button { width: 74px; height: 68px; }
.record-controls button:only-child { width: 150px; height: 55px; }
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

.candidate-stage {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: min(100%, 220px);
  max-height: 160px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  /* Checkerboard so transparent PNG alpha is visible in preview. */
  background-color: #ece8e1;
  background-image:
    linear-gradient(45deg, #d9d3c8 25%, transparent 25%),
    linear-gradient(-45deg, #d9d3c8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d9d3c8 75%),
    linear-gradient(-45deg, transparent 75%, #d9d3c8 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.candidate-image {
  display: block;
  width: 100%;
  max-height: 144px;
  height: auto;
  object-fit: contain;
  background: transparent;
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

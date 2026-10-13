<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
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
import textArt from '../../../../assets/ui/creation/voice-text.png'
import sendArt from '../../../../assets/ui/hand-drawn/btn-send.png'
import { handDrawnAssets } from '../ui/hand-drawn-assets'
import { conciseCopy } from '../ui/concise-copy'
import recordReset from '../../../../assets/ui/creation/record-reset.png'

const props = defineProps<{ useCandidate?: (accepted: CreationIntentAccepted) => Promise<void> }>()
const actionBackground = `url("${handDrawnAssets.btnPrimary}")`
const paused = ref(false), startingMic = ref(false), placing = ref(false)
let voiceTimer: ReturnType<typeof setTimeout> | undefined, disposed = false

const helpOpen = ref(false), editing = ref(false)
const originalDescription = ref('')
const controller = reactive(new CreationIntentController())
const scrollArea = ref<HTMLElement>()
const pageRoot = ref<HTMLElement>()
// Reset only the content slot on stage changes; never push the whole dialog to its bottom.
watch(() => [controller.phase, controller.question], async () => {
  if (controller.hasPlan) editing.value = false
  await nextTick()
  if (scrollArea.value) scrollArea.value.scrollTop = 0
  if (!disposed) {
    const target = scrollArea.value?.querySelector<HTMLTextAreaElement>('textarea')
      ?? pageRoot.value?.querySelector<HTMLButtonElement>('.actions button:not(:disabled)')
    target?.focus()
  }
})
async function submitDescription(): Promise<void> {
  if (!controller.hasPlan) originalDescription.value = controller.text
  await controller.submitCurrentText()
  if (!controller.error) editing.value = false
}
function editDescription(): void {
  const previous = originalDescription.value
  resetAll()
  controller.text = previous
}
const inputVisible = computed(() => !controller.hasPlan || editing.value || Boolean(controller.question))
const recorder = new MicRecorder()
const recording = ref(false)
const transcribing = ref(false)
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
  if (verdict === 'FAIL') return '剪贴可能较难 · 查看建议'
  if (verdict === 'WARN') return '剪贴提醒 · 查看建议'
  if (verdict === 'PASS') return '看起来适合做成不织布'
  return ''
})
const voiceBusy = computed(() => recording.value || startingMic.value || transcribing.value || controller.busy || placing.value)

onUnmounted(() => {
  disposed = true; clearTimeout(voiceTimer)
  recorder.cancel()
})

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
    if (!disposed) {
      // Let the user check recognition before submitting their meaning.
      controller.text = parsed.transcript
      editing.value = true
    }
  } catch (error) {
    controller.error =
      error instanceof Error ? error.message : '语音识别暂时用不了。请稍后再试，或先在上面打字。'
    voiceRetry.value = true
  } finally {
    transcribing.value = false
    await nextTick()
    if (!disposed) scrollArea.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }
}

function resetAll(): void {
  clearTimeout(voiceTimer); paused.value = false
  recorder.cancel()
  recording.value = false
  transcribing.value = false
  voiceRetry.value = false
  controller.reset()
  editing.value = false
  helpOpen.value = false
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
  <section ref="pageRoot" class="create-page" aria-label="生成作品">
    <header class="section-head">
      <h2>{{ compiled ? '看看这张图' : controller.hasPlan && !inputVisible ? '确认绘画内容' : '想画什么？' }}</h2>
      <button class="help-toggle" type="button" :aria-expanded="helpOpen" @click="helpOpen = !helpOpen">{{ helpOpen ? '返回创作' : '怎么用' }}</button>
    </header>
    <div class="actions">
      <template v-if="!helpOpen">
        <div v-if="!compiled && inputVisible" class="record-controls">
          <ArtworkButton v-if="!recording" :image="recordStart" bounds="768 566 385 140" label="开始录音" :disabled="voiceBusy" @click="toggleVoice" />
          <template v-else>
            <ArtworkButton :image="paused ? recordResume : recordPause" bounds="604 540 233 219" :label="paused ? '继续录音' : '暂停录音'" @click="pauseVoice" />
            <ArtworkButton :image="recordDone" bounds="844 540 233 219" label="完成录音" @click="toggleVoice" />
            <ArtworkButton :image="recordReset" bounds="1090 540 233 219" label="重新录音" @click="restartVoice" />
          </template>
        </div>
        <button v-if="!compiled && inputVisible" type="button" class="send-art" aria-label="发送描述" :disabled="voiceBusy || !controller.text.trim()" @click="submitDescription"><img :src="sendArt" alt="" /></button>
        <button v-if="!compiled && !inputVisible" type="button" class="source-action" :disabled="voiceBusy" @click="editing = true">补充描述</button>
        <button v-if="!compiled && !inputVisible" type="button" class="source-action" :disabled="voiceBusy" @click="editDescription">修改描述</button>
        <button v-if="canDecideForMe" type="button" class="source-action" :disabled="voiceBusy" @click="controller.decideForMe()">你来定</button>
        <button v-if="controller.canRetry" type="button" class="source-action" :disabled="voiceBusy" @click="controller.retryLastFailure()">再试一次</button>
        <button v-else-if="canConfirm && !inputVisible" type="button" class="source-action" :disabled="voiceBusy" @click="controller.confirmPlan()">就这样画</button>
        <template v-if="compiled && !controller.canRetry">
          <button v-if="controller.candidateRef" type="button" class="source-action" :disabled="voiceBusy" @click="startWork">使用这张图</button>
          <button type="button" class="source-action" :disabled="voiceBusy" @click="controller.redrawCandidate()">再画一张</button>
          <button type="button" class="source-action" :disabled="voiceBusy" @click="resetAll">重新说</button>
        </template>
        <button v-if="voiceRetry && !controller.canRetry" type="button" class="source-action" :disabled="voiceBusy" @click="retryVoice">重新录音</button>
      </template>
    </div>
    <p class="action-status" :class="{ error: controller.error }" role="status">{{ conciseCopy(controller.error) || (transcribing ? '正在识别录音…' : recording ? (paused ? '录音已暂停' : '正在录音…') : controller.busyHint || (placing ? '正在加入画布…' : '')) }}</p>
    <!-- Unmodified 1920×1080 artwork, exact original bounds relative to the supplied panel. -->
    <svg class="text-art" viewBox="638 459 664 333" aria-hidden="true"><image :href="textArt" width="1920" height="1080" /></svg>
    <div ref="scrollArea" class="create-scroll">
      <div v-if="helpOpen" class="help-copy">
        <h3>怎么用</h3>
        <p>1. 打字或录音，确认文字后发送。</p>
        <p>2. 检查绘画内容，可补充或修改；其余内容不必填写。</p>
        <p>3. 点“就这样画”，满意后点“使用这张图”。</p>
      </div>
      <label v-else-if="inputVisible && !compiled" class="say-box">
        <span>{{ controller.question || (controller.hasPlan ? '还想补充什么？' : '想画什么') }}</span>
        <textarea v-model="controller.text" rows="5" maxlength="120" :disabled="voiceBusy" :placeholder="controller.question ? '' : '例如：一只红色兔子坐在草地上'" @keydown.ctrl.enter.prevent="!voiceBusy && submitDescription()"></textarea>
        <div v-if="controller.choices.length" class="choices">
          <button v-for="choice in controller.choices" :key="choice" class="choice-button hand-btn-secondary" type="button" :disabled="voiceBusy" @click="controller.acceptUtterance(choice)">{{ choice }}</button>
        </div>
        <button v-if="controller.hasPlan && !controller.question" class="text-link" @click="editing = false">返回方案</button>
      </label>
      <div v-else-if="controller.showPlanCard && !compiled" class="plan-card">
        <dl class="plan-fields">
          <div v-for="field in controller.plan.fields.filter(field => field.value || !field.optional || field.status === 'pending')" :key="field.key" class="plan-row" :data-status="field.status">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value || '待补充' }}</dd>
          </div>
        </dl>
      </div>
      <div v-else-if="compiled" class="preview-block">
        <img v-if="controller.candidateRef" class="candidate-image" :src="controller.candidateRef" alt="生成的核心图案预览" />
        <details v-if="controller.quality && controller.quality.verdict !== 'PASS'" class="quality-notice">
          <summary>{{ qualityHeadline }}</summary>
          <p v-for="message in controller.quality.messages" :key="message">{{ conciseCopy(message) }}</p>
        </details>
      </div>
    </div>
  </section>
</template>

<style scoped>
.create-page { position: relative; width: 743px; height: 568px; color: #652415; --action-art: v-bind(actionBackground); }
.section-head { position: absolute; left: 39px; top: 28px; width: 615px; display: flex; align-items: center; justify-content: space-between; }
h2, h3, p { margin: 0; } h2 { font-size: 28px; } h3 { font-size: 22px; margin-bottom: 10px; }
.actions { position: absolute; left: 39px; top: 108px; width: 664px; height: 62px; display: flex; gap: 12px; align-items: center; }
.record-controls { display: flex; gap: 8px; align-items: center; }
.record-controls button { width: 62px; height: 58px; }
.record-controls button:only-child { width: 150px; height: 55px; }
.send-art { padding: 0; border: 0; width: 125px; height: 56px; background: transparent; }
.send-art img { display: block; width: 100%; height: 100%; object-fit: contain; }
.source-action { width: 136px; height: 60px; border: 0; padding: 8px; background: var(--action-art) center / 100% 100% no-repeat; color: inherit; font-size: 20px; font-weight: 700; }
.help-toggle, .text-link { background: transparent; color: inherit; border: 0; text-decoration: underline; padding: 4px 8px; font-size: 18px; }
.choice-button { min-height: 42px; padding: 6px 16px; font-size: 18px; }
.action-status { position: absolute; left: 39px; top: 173px; width: 664px; height: 25px; overflow-y: auto; line-height: 25px; font-size: 17px; }
.error { color: #8e2516; }
.text-art { position: absolute; left: 39px; top: 200px; width: 664px; height: 333px; pointer-events: none; }
.create-scroll { position: absolute; left: 59px; top: 218px; width: 624px; height: 295px; overflow-y: auto; overflow-x: hidden; }
.say-box { display: flex; flex-direction: column; min-height: 100%; gap: 8px; font-size: 21px; }
textarea { box-sizing: border-box; width: 100%; min-height: 170px; flex: 1; resize: none; padding: 8px; font: inherit; color: inherit; border: 0; background: transparent; }
textarea::placeholder { color: #806a42; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; }
.plan-fields { display: grid; gap: 7px; margin: 0; font-size: 20px; }
.plan-row { display: grid; grid-template-columns: 170px 1fr; gap: 10px; line-height: 1.45; }
.plan-row dt { font-weight: bold; } .plan-row dd { margin: 0; overflow-wrap: anywhere; }
.plan-row small { font-size: 16px; font-weight: normal; }
.help-copy { font-size: 21px; line-height: 1.6; } .help-copy p { margin-bottom: 10px; }
.preview-block { text-align: center; font-size: 18px; line-height: 1.5; }
.candidate-image { max-width: 100%; height: 200px; object-fit: contain; }
button:disabled { opacity: .5; }
button:focus-visible, textarea:focus-visible { outline: 3px solid #71331d; outline-offset: -3px; }
</style>

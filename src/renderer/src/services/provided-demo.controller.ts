import { createEmptyGenerationSpec } from '@shared/contracts'
import { CreationIntentController, planFromSpec } from './creation-intent.controller'
import { originalPsdEdit, providedPsdPack, psdImageDataUrl } from '../projection/provided-psd-artwork'
import { persistCanvasInput } from '../fabrication/canvas-intake'
import { getCurrentUserId } from './plaza-session'
import { decodePngDataUrl } from './png-data-url'

/** Explicit build/dev switch. Normal creation and all QA/ASR/TTS APIs are untouched. */
export function isProvidedPsdDemoEnabled(value: unknown = import.meta.env.VITE_PROVIDED_PSD_DEMO): boolean { return value === '1' }

export class ProvidedDemoController extends CreationIntentController {
  private epoch = 0
  override async acceptUtterance(raw: string): Promise<void> {
    if (this.busy) return
    if (!raw.trim()) { this.error = '请先说想画什么。'; return }
    const spec = createEmptyGenerationSpec('core_pattern')
    spec.content.primarySubjects = [{ name: raw.trim().slice(0, 120) }]
    this.sessionId ||= crypto.randomUUID()
    this.plan = planFromSpec(spec); this.summary = raw.trim(); this.text = ''
    this.phase = 'ready_to_confirm'; this.question = null; this.choices = []; this.error = null
    this.accepted = null; this.candidateRef = null; this.retryAction = null
  }
  override async submitCurrentText(): Promise<void> { await this.acceptUtterance(this.text) }
  override async confirmPlan(): Promise<void> {
    if (!this.sessionId || this.busy) return
    const token = this.epoch
    this.busy = true; this.busyHint = '正在生成图片…'; this.error = null
    this.candidateRef = null; this.accepted = null; this.phase = 'ready_to_confirm'
    try {
      const pack = providedPsdPack('fuwa')
      // Demo pacing only: prepare in parallel, but never reveal a cached image before five seconds.
      const [preview] = await Promise.all([
        psdImageDataUrl(pack.imageUrl, pack.imageSha256),
        new Promise<void>(resolve => setTimeout(resolve, 5_000))
      ])
      if (token === this.epoch) { this.candidateRef = preview; this.phase = 'generated'; this.accepted = null; this.retryAction = null }
    } catch (cause) { if (token === this.epoch) { this.error = (cause as Error).message; this.retryAction = 'confirm' } }
    finally { if (token === this.epoch) { this.busy = false; this.busyHint = null } }
  }
  override async redrawCandidate(): Promise<void> { await this.confirmPlan() }
  override async decideForMe(): Promise<void> { await this.confirmPlan() }
  override async acceptCandidate(): Promise<void> {
    if (!this.candidateRef || this.busy || this.accepted) return
    const token = this.epoch
    this.busy = true; this.busyHint = '正在打开作品…'; this.error = null
    try {
      const bytes = decodePngDataUrl(this.candidateRef)
      const { asset, version } = await persistCanvasInput(bytes, '福娃', getCurrentUserId(), 'ai_generated', originalPsdEdit(providedPsdPack('fuwa')), 'core_pattern')
      if (token === this.epoch) {
        this.accepted = { personalAssetId: asset.personalAssetId, versionId: version.versionId, sourceImageRef: version.sourceImageRef, name: '福娃', role: 'core_pattern' }
        this.phase = 'accepted'; this.retryAction = null
      }
    } catch (cause) { if (token === this.epoch) { this.error = (cause as Error).message; this.retryAction = 'accept' } }
    finally { if (token === this.epoch) { this.busy = false; this.busyHint = null } }
  }
  override reset(): void { this.epoch++; super.reset() }
  dispose(): void { this.reset() }
}

import { randomUUID } from 'node:crypto'
import type { ResourceRef, SharedError } from '@shared/contracts'
import { toSharedError } from '@shared/contracts/error'
import type { GenerationSpec } from '@shared/contracts/generation-spec'
import { GENERATION_SPEC_POLLUTION_KEYS } from '@shared/contracts/generation-spec'
import { PERSONAL_ASSET_ROLES, type PersonalAssetRole } from '@shared/contracts/personal-asset'
import type {
  GenerationQualityReport,
  ProviderPromptPayload
} from '@shared/contracts/generation-candidate'
import { canAcceptCandidate, candidateStatusForQuality } from '@shared/contracts/generation-candidate'
import { toProviderPromptPayload } from '@shared/prompt-compiler'
import {
  CreationIntentSession,
  LocalCreationIntentParser,
  MAX_CREATION_INTENT_SESSIONS,
  MAX_CREATION_INTENT_TEXT_CHARS,
  type CreationIntentAccepted,
  type CreationIntentIpcResult,
  type CreationIntentParser,
  type CreationSessionSnapshot
} from '@shared/creation-intent'
import { renderMockFeltPng } from '../image-generation'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TemporaryPngSaveResult =
  | { ok: true; ref: ResourceRef }
  | { ok: false; error: SharedError }

export type GeneratedPngResult = {
  bytes: Uint8Array
  width?: number
  height?: number
  quality?: GenerationQualityReport
}

export type GenerateCandidatePngFn = (
  payload: ProviderPromptPayload,
  spec: GenerationSpec
) => Promise<GeneratedPngResult | Uint8Array> | GeneratedPngResult | Uint8Array

export type ReadTemporaryPngFn = (ref: ResourceRef) => TemporaryPngReadResult

export type TemporaryPngReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: SharedError }

export type IngestPersonalPngFn = (input: {
  personalAssetId: string
  versionId: string
  pngBytes: Uint8Array
}) => TemporaryPngSaveResult

export interface CreationIntentHostOptions {
  parser?: CreationIntentParser
  createId?: () => string
  now?: () => string
  saveTemporaryPng?: (bytes: Uint8Array) => TemporaryPngSaveResult
  readTemporaryPng?: ReadTemporaryPngFn
  ingestPersonalPng?: IngestPersonalPngFn
  generatePng?: GenerateCandidatePngFn
}

function fail(message: string): CreationIntentIpcResult {
  return {
    ok: false,
    error: toSharedError({ code: 'INVALID_ARGUMENT', message, retryable: false }, 'INVALID_ARGUMENT')
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function cloneSnapshot(snapshot: CreationSessionSnapshot): CreationSessionSnapshot {
  return structuredClone(snapshot)
}

function ok(
  sessionId: string,
  snapshot: CreationSessionSnapshot,
  accepted?: CreationIntentAccepted
): CreationIntentIpcResult {
  return {
    ok: true,
    sessionId,
    snapshot: cloneSnapshot(snapshot),
    ...(accepted ? { accepted } : {})
  }
}

function nameFromSpec(spec: GenerationSpec): string {
  const names = spec.content.primarySubjects.map((subject) => subject.name.trim()).filter(Boolean)
  return names.slice(0, 3).join('和') || '核心图案'
}

function rejectPollution(value: Record<string, unknown>): SharedError | null {
  for (const key of GENERATION_SPEC_POLLUTION_KEYS) {
    if (key in value) {
      return toSharedError(
        { code: 'INVALID_ARGUMENT', message: '不得写入 Prompt 或 Provider 字段。', retryable: false },
        'INVALID_ARGUMENT'
      )
    }
  }
  return null
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function readSessionId(value: unknown): string | null {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null
}

function readLockedRole(value: unknown): PersonalAssetRole | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (PERSONAL_ASSET_ROLES.includes(value as PersonalAssetRole)) return value as PersonalAssetRole
  return 'invalid'
}

export class CreationIntentHost {
  private readonly parser: CreationIntentParser
  private readonly createId: () => string
  private readonly now: () => string
  private readonly saveTemporaryPng?: (bytes: Uint8Array) => TemporaryPngSaveResult
  private readonly readTemporaryPng?: ReadTemporaryPngFn
  private readonly ingestPersonalPng?: IngestPersonalPngFn
  private readonly generatePng: GenerateCandidatePngFn
  private readonly sessions = new Map<string, CreationIntentSession>()
  private readonly acceptedBySession = new Map<string, CreationIntentAccepted>()

  constructor(options: CreationIntentHostOptions = {}) {
    this.parser = options.parser ?? new LocalCreationIntentParser()
    this.createId = options.createId ?? (() => randomUUID())
    this.now = options.now ?? (() => new Date().toISOString())
    this.saveTemporaryPng = options.saveTemporaryPng
    this.readTemporaryPng = options.readTemporaryPng
    this.ingestPersonalPng = options.ingestPersonalPng
    this.generatePng =
      options.generatePng ??
      (async (payload, spec) => ({
        bytes: renderMockFeltPng(payload, spec),
        width: payload.width,
        height: payload.height,
        quality: { verdict: 'PASS' as const, messages: ['本地占位图，先按可制作处理。'] }
      }))
  }

  start(raw: unknown = {}): CreationIntentIpcResult {
    const value = asRecord(raw) ?? (raw === undefined ? {} : null)
    if (!value) return fail('创作请求无效。')
    const polluted = rejectPollution(value)
    if (polluted) return { ok: false, error: polluted }
    if (!hasOnlyKeys(value, ['lockedRole'])) return fail('创作请求无效。')

    const lockedRole = readLockedRole(value.lockedRole)
    if (lockedRole === 'invalid') return fail('素材角色无效。')

    while (this.sessions.size >= MAX_CREATION_INTENT_SESSIONS) {
      const oldest = this.sessions.keys().next().value
      if (!oldest) break
      this.sessions.delete(oldest)
      this.acceptedBySession.delete(oldest)
    }

    const sessionId = this.createId()
    const session = new CreationIntentSession({
      parser: this.parser,
      ...(lockedRole ? { lockedRole } : {})
    })
    this.sessions.set(sessionId, session)
    return ok(sessionId, session.getSnapshot())
  }

  async submit(raw: unknown): Promise<CreationIntentIpcResult> {
    const parsed = this.readSessionRequest(raw, ['sessionId', 'text'])
    if (!('kind' in parsed)) return parsed
    const text = parsed.value.text
    if (typeof text !== 'string' || !text.trim()) return fail('请先说想画什么。')
    if (text.length > MAX_CREATION_INTENT_TEXT_CHARS) return fail('这句话有点长，请再说短一点。')

    const snapshot = await parsed.session.submitText(text.trim())
    return ok(parsed.sessionId, snapshot)
  }

  async confirm(raw: unknown): Promise<CreationIntentIpcResult> {
    const parsed = this.readSessionRequest(raw, ['sessionId'])
    if (!('kind' in parsed)) return parsed
    const snapshot = parsed.session.confirm(this.now())
    if (!snapshot.prompt || !this.saveTemporaryPng) return ok(parsed.sessionId, snapshot)
    return this.materializeCandidate(parsed.sessionId, parsed.session, snapshot)
  }

  /** Keep the confirmed plan/prompt; draw a new temporary image. */
  async regenerate(raw: unknown): Promise<CreationIntentIpcResult> {
    const parsed = this.readSessionRequest(raw, ['sessionId'])
    if (!('kind' in parsed)) return parsed
    this.acceptedBySession.delete(parsed.sessionId)
    const snapshot = parsed.session.clearCandidateForRedraw()
    if (!snapshot.prompt || snapshot.spec.confirmation.status !== 'confirmed') {
      return fail('请先确认方案再画图。')
    }
    if (!this.saveTemporaryPng) return fail('暂时无法画图。')
    return this.materializeCandidate(parsed.sessionId, parsed.session, snapshot)
  }

  decideForMe(raw: unknown): CreationIntentIpcResult {
    const parsed = this.readSessionRequest(raw, ['sessionId'])
    if (!('kind' in parsed)) return parsed
    return ok(parsed.sessionId, parsed.session.decideForMe())
  }

  private async materializeCandidate(
    sessionId: string,
    session: CreationIntentSession,
    snapshot: CreationSessionSnapshot
  ): Promise<CreationIntentIpcResult> {
    if (!snapshot.prompt || !this.saveTemporaryPng) return ok(sessionId, snapshot)
    try {
      const payload = toProviderPromptPayload(snapshot.prompt)
      const generated = await this.generatePng(payload, snapshot.spec)
      const png = generated instanceof Uint8Array ? generated : generated.bytes
      const quality = generated instanceof Uint8Array ? undefined : generated.quality
      const width =
        generated instanceof Uint8Array ? payload.width : (generated.width ?? payload.width)
      const height =
        generated instanceof Uint8Array ? payload.height : (generated.height ?? payload.height)
      const saved = this.saveTemporaryPng(png)
      if (!saved.ok) return { ok: false, error: saved.error }

      return ok(
        sessionId,
        session.attachCandidate({
          candidateId: this.createId(),
          generationRequestId: sessionId,
          assetRole: snapshot.spec.assetRole,
          status: candidateStatusForQuality(quality),
          temporaryRef: saved.ref,
          width,
          height,
          createdAt: this.now(),
          ...(quality ? { quality } : {})
        })
      )
    } catch (error) {
      return {
        ok: false,
        error: toSharedError(
          {
            code: 'UNKNOWN',
            message:
              error instanceof Error && error.message.trim()
                ? error.message
                : '画图暂时无法完成，请稍后重试。',
            retryable: true
          },
          'UNKNOWN'
        )
      }
    }
  }

  snapshot(raw: unknown): CreationIntentIpcResult {
    const parsed = this.readSessionRequest(raw, ['sessionId'])
    if (!('kind' in parsed)) return parsed
    return ok(parsed.sessionId, parsed.session.getSnapshot(), this.acceptedBySession.get(parsed.sessionId))
  }

  async accept(raw: unknown): Promise<CreationIntentIpcResult> {
    const parsed = this.readSessionRequest(raw, ['sessionId'])
    if (!('kind' in parsed)) return parsed

    const existing = this.acceptedBySession.get(parsed.sessionId)
    if (existing) {
      return ok(parsed.sessionId, parsed.session.getSnapshot(), existing)
    }

    const snapshot = parsed.session.getSnapshot()
    const candidate = snapshot.candidate
    if (!candidate) return fail('还没有可以用的图。')
    if (!canAcceptCandidate(candidate)) {
      return fail('这张图不太适合做成不织布，请再画一张。')
    }
    if (!this.readTemporaryPng || !this.ingestPersonalPng) {
      return fail('暂时无法开始这件作品。')
    }

    const bytes = this.readTemporaryPng(candidate.temporaryRef)
    if (!bytes.ok) return { ok: false, error: bytes.error }

    const personalAssetId = this.createId()
    const versionId = this.createId()
    const ingested = this.ingestPersonalPng({
      personalAssetId,
      versionId,
      pngBytes: bytes.bytes
    })
    if (!ingested.ok) return { ok: false, error: ingested.error }

    const accepted: CreationIntentAccepted = {
      personalAssetId,
      versionId,
      sourceImageRef: ingested.ref,
      name: nameFromSpec(snapshot.spec),
      role: snapshot.spec.assetRole
    }
    this.acceptedBySession.set(parsed.sessionId, accepted)
    return ok(parsed.sessionId, parsed.session.markCandidateAccepted(), accepted)
  }

  private readSessionRequest(
    raw: unknown,
    allowed: readonly string[]
  ):
    | { kind: 'session'; sessionId: string; session: CreationIntentSession; value: Record<string, unknown> }
    | CreationIntentIpcResult {
    const value = asRecord(raw)
    if (!value) return fail('创作请求无效。')
    const polluted = rejectPollution(value)
    if (polluted) return { ok: false, error: polluted }
    if (!hasOnlyKeys(value, allowed)) return fail('创作请求无效。')

    const sessionId = readSessionId(value.sessionId)
    if (!sessionId) return fail('创作会话无效。')
    const session = this.sessions.get(sessionId)
    if (!session) return fail('创作会话不存在。')
    return { kind: 'session', sessionId, session, value }
  }
}

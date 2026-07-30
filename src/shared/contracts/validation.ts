import { ASR_PROVIDERS, ASSET_RUNTIME_STATUSES, ASSET_TYPES, SCHEMA_VERSION } from './common'
import type { AssetAccessState, AssetAudioRefs, AssetRecord } from './asset'
import type { AsrResult, QaResult, TtsResult } from './ai'
import { SHARED_ERROR_CODES } from './error'
import type { SharedError } from './error'
import { PROJECT_SYNC_STATUSES } from './project'
import type { DraftRecord, ProjectRecord } from './project'
import type { SceneDocument, SceneObject } from './scene'

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationIssue[] }

type RawObject = Record<string, unknown>

const UTC_ISO_8601_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_RESOURCE_PROTOCOLS = new Set(['app:', 'asset:', 'mock:'])
const SECRET_QUERY_KEYS = /(?:token|key|secret|signature|sig|password|auth)/i
const HEX_COLOR = /^#[0-9a-f]{3,4}$|^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i
const CSS_FUNCTION_COLOR = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([^()]+\)$/i
const CSS_COLOR_NAME = /^[a-z]+$/i

function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value }
}

function failure(errors: ValidationIssue[]): ValidationResult<never> {
  return { ok: false, errors }
}

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: RawObject, allowed: readonly string[], path: string, errors: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ path: `${path}.${key}`, message: '涓嶅睘浜庢鎸佷箙鍖栧绾︾殑瀛楁銆? })
  }
}

function requireObject(value: unknown, path: string, errors: ValidationIssue[]): RawObject | undefined {
  if (!isObject(value)) {
    errors.push({ path, message: '蹇呴』鏄櫘閫氬璞°€? })
    return undefined
  }
  return value
}

function requireString(value: unknown, path: string, errors: ValidationIssue[], allowEmpty = false): value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    errors.push({ path, message: '蹇呴』鏄潪绌哄瓧绗︿覆銆? })
    return false
  }
  return true
}

function requireOptionalString(value: unknown, path: string, errors: ValidationIssue[]): value is string | undefined {
  return value === undefined || requireString(value, path, errors)
}

function requireFiniteNumber(value: unknown, path: string, errors: ValidationIssue[]): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path, message: '蹇呴』鏄湁闄愭暟瀛椼€? })
    return false
  }
  return true
}

function requireNonNegativeInteger(value: unknown, path: string, errors: ValidationIssue[]): value is number {
  if (!requireFiniteNumber(value, path, errors)) return false
  if (!Number.isInteger(value) || value < 0) {
    errors.push({ path, message: '蹇呴』鏄潪璐熸暣鏁般€? })
    return false
  }
  return true
}

function requireBoolean(value: unknown, path: string, errors: ValidationIssue[]): value is boolean {
  if (typeof value !== 'boolean') {
    errors.push({ path, message: '蹇呴』鏄竷灏斿€笺€? })
    return false
  }
  return true
}

function requireUuid(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!requireString(value, path, errors)) return false
  if (!UUID.test(value)) {
    errors.push({ path, message: '蹇呴』鏄疷UID鏍煎紡鐨勯殢鏈烘爣璇嗐€? })
    return false
  }
  return true
}

function requireUtcTimestamp(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!requireString(value, path, errors)) return false
  if (!UTC_ISO_8601_MS.test(value) || new Date(value).toISOString() !== value) {
    errors.push({ path, message: '蹇呴』鏄疷TC ISO8601姣鏃堕棿鎴炽€? })
    return false
  }
  return true
}

export function isSafeResourceRef(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('..') || /[\\\r\n]/.test(value)) return false
  try {
    const resource = new URL(value)
    if (!SAFE_RESOURCE_PROTOCOLS.has(resource.protocol)) return false
    return ![...resource.searchParams.keys(), ...resource.searchParams.values()].some((part) => SECRET_QUERY_KEYS.test(part))
  } catch {
    return false
  }
}

function requireResourceRef(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!isSafeResourceRef(value)) {
    errors.push({ path, message: '蹇呴』鏄畨鍏ㄣ€佺敱搴旂敤绠＄悊鐨勮祫婧愬紩鐢ㄣ€? })
    return false
  }
  return true
}

function requireStringArray(value: unknown, path: string, errors: ValidationIssue[]): value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    errors.push({ path, message: '蹇呴』鏄敱闈炵┖瀛楃涓茬粍鎴愮殑鏁扮粍銆? })
    return false
  }
  if (new Set(value).size !== value.length) {
    errors.push({ path, message: '涓嶅緱鍖呭惈閲嶅椤广€? })
    return false
  }
  return true
}

function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && (HEX_COLOR.test(value) || CSS_FUNCTION_COLOR.test(value) || CSS_COLOR_NAME.test(value))
}

export function validateAssetRecord(raw: unknown): ValidationResult<AssetRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'asset', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['assetId', 'type', 'themeId', 'categoryIds', 'nameZh', 'nameEn', 'introZh', 'keywords', 'imageUrl', 'thumbnailUrl', 'preSplitDataUrl', 'audio', 'source', 'license', 'contentVersion', 'status'], 'asset', errors)
  requireString(value.assetId, 'asset.assetId', errors)
  if (!ASSET_TYPES.includes(value.type as (typeof ASSET_TYPES)[number])) errors.push({ path: 'asset.type', message: '蹇呴』鏄痓ackground鎴杝ticker銆? })
  requireString(value.themeId, 'asset.themeId', errors)
  requireStringArray(value.categoryIds, 'asset.categoryIds', errors)
  requireString(value.nameZh, 'asset.nameZh', errors, true)
  requireString(value.nameEn, 'asset.nameEn', errors, true)
  requireString(value.introZh, 'asset.introZh', errors, true)
  requireStringArray(value.keywords, 'asset.keywords', errors)
  requireResourceRef(value.imageUrl, 'asset.imageUrl', errors)
  if (value.thumbnailUrl !== undefined) requireResourceRef(value.thumbnailUrl, 'asset.thumbnailUrl', errors)
  if (value.preSplitDataUrl !== undefined) {
    requireResourceRef(value.preSplitDataUrl, 'asset.preSplitDataUrl', errors)
    if (value.type !== 'sticker') errors.push({ path: 'asset.preSplitDataUrl', message: '棰勬媶鍒嗘暟鎹彧鍏佽璐寸焊绱犳潗浣跨敤銆? })
  }
  const audio = requireObject(value.audio, 'asset.audio', errors)
  if (audio) validateAssetAudioRefs(audio, 'asset.audio', errors)
  requireOptionalString(value.source, 'asset.source', errors)
  requireOptionalString(value.license, 'asset.license', errors)
  if (!requireFiniteNumber(value.contentVersion, 'asset.contentVersion', errors) || !Number.isInteger(value.contentVersion) || value.contentVersion < 1) {
    errors.push({ path: 'asset.contentVersion', message: '蹇呴』鏄ぇ浜庣瓑浜?鐨勬暣鏁般€? })
  }
  if (!ASSET_RUNTIME_STATUSES.includes(value.status as (typeof ASSET_RUNTIME_STATUSES)[number])) errors.push({ path: 'asset.status', message: '蹇呴』鏄痳eady鎴杢est_only銆? })
  if (value.status === 'ready') {
    requireString(value.nameZh, 'asset.nameZh', errors)
    requireString(value.nameEn, 'asset.nameEn', errors)
    requireString(value.introZh, 'asset.introZh', errors)
  }
  return errors.length ? failure(errors) : success(raw as AssetRecord)
}

function validateAssetAudioRefs(value: RawObject, path: string, errors: ValidationIssue[]): value is AssetAudioRefs {
  hasOnlyKeys(value, ['nameZhUrl', 'nameEnUrl', 'introZhUrl'], path, errors)
  for (const key of ['nameZhUrl', 'nameEnUrl', 'introZhUrl'] as const) {
    if (value[key] !== undefined) requireResourceRef(value[key], `${path}.${key}`, errors)
  }
  return errors.length === 0
}

export function validateAssetAccessState(raw: unknown): ValidationResult<AssetAccessState> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'access', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['userId', 'assetId', 'unlocked', 'unlockSource', 'updatedAt'], 'access', errors)
  requireString(value.userId, 'access.userId', errors)
  requireString(value.assetId, 'access.assetId', errors)
  requireBoolean(value.unlocked, 'access.unlocked', errors)
  requireOptionalString(value.unlockSource, 'access.unlockSource', errors)
  requireUtcTimestamp(value.updatedAt, 'access.updatedAt', errors)
  return errors.length ? failure(errors) : success(raw as AssetAccessState)
}

export function validateSceneObject(raw: unknown): ValidationResult<SceneObject> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'sceneObject', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['objectId', 'assetId', 'assetType', 'left', 'top', 'scaleX', 'scaleY', 'angle', 'zIndex', 'visible', 'locked'], 'sceneObject', errors)
  requireUuid(value.objectId, 'sceneObject.objectId', errors)
  requireString(value.assetId, 'sceneObject.assetId', errors)
  if (value.assetType !== 'sticker') errors.push({ path: 'sceneObject.assetType', message: '鑳屾櫙闅愬紡鍥哄畾鍦▃Index=0锛宱bjects鍙兘鍖呭惈璐寸焊銆? })
  requireFiniteNumber(value.left, 'sceneObject.left', errors)
  requireFiniteNumber(value.top, 'sceneObject.top', errors)
  const hasScaleX = requireFiniteNumber(value.scaleX, 'sceneObject.scaleX', errors)
  const hasScaleY = requireFiniteNumber(value.scaleY, 'sceneObject.scaleY', errors)
  if (hasScaleX && hasScaleY && (value.scaleX <= 0 || value.scaleY <= 0 || value.scaleX !== value.scaleY)) {
    errors.push({ path: 'sceneObject.scaleX', message: 'V1鍙敮鎸佸ぇ浜?鐨勭瓑姣斾緥缂╂斁銆? })
  }
  if (requireFiniteNumber(value.angle, 'sceneObject.angle', errors) && (value.angle < -180 || value.angle >= 180)) {
    errors.push({ path: 'sceneObject.angle', message: '瑙掑害蹇呴』瑙勮寖鍖栧埌[-180, 180)銆? })
  }
  if (!requireFiniteNumber(value.zIndex, 'sceneObject.zIndex', errors) || !Number.isInteger(value.zIndex) || value.zIndex < 1) {
    errors.push({ path: 'sceneObject.zIndex', message: '璐寸焊zIndex蹇呴』涓轰粠1寮€濮嬬殑鏁存暟銆? })
  }
  const visible = requireBoolean(value.visible, 'sceneObject.visible', errors)
  const locked = requireBoolean(value.locked, 'sceneObject.locked', errors)
  if (visible && value.visible !== true) errors.push({ path: 'sceneObject.visible', message: 'V1鎸佷箙鍖栬创绾稿繀椤诲彲瑙併€? })
  if (locked && value.locked !== false && value.locked !== true) errors.push({ path: 'sceneObject.locked', message: '鍙楅檺鍗犱綅瀵硅薄鐨刲ocked蹇呴』涓簍rue銆? })
  return errors.length ? failure(errors) : success(raw as SceneObject)
}

export function validateSceneDocument(raw: unknown): ValidationResult<SceneDocument> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'scene', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['schemaVersion', 'sceneId', 'userId', 'workName', 'themeId', 'assetSnapshotId', 'canvas', 'backgroundAssetId', 'objects', 'createdAt', 'updatedAt'], 'scene', errors)
  if (value.schemaVersion !== SCHEMA_VERSION) errors.push({ path: 'scene.schemaVersion', message: '涓嶆敮鎸佺殑Scene schemaVersion銆? })
  requireUuid(value.sceneId, 'scene.sceneId', errors)
  requireString(value.userId, 'scene.userId', errors)
  requireString(value.workName, 'scene.workName', errors, true)
  requireString(value.themeId, 'scene.themeId', errors)
  requireString(value.assetSnapshotId, 'scene.assetSnapshotId', errors)
  validateCanvas(value.canvas, errors)
  if (value.backgroundAssetId !== null && !requireString(value.backgroundAssetId, 'scene.backgroundAssetId', errors)) {
    // The diagnostic was emitted by requireString.
  }
  if (!Array.isArray(value.objects)) {
    errors.push({ path: 'scene.objects', message: '蹇呴』鏄璞℃暟缁勩€? })
  } else {
    const objectIds = new Set<string>()
    for (const [index, object] of value.objects.entries()) {
      const result = validateSceneObject(object)
      if (!result.ok) errors.push(...result.errors.map((issue) => ({ ...issue, path: `scene.objects[${index}].${issue.path.replace(/^sceneObject\./, '')}` })))
      else if (objectIds.has(result.value.objectId)) errors.push({ path: `scene.objects[${index}].objectId`, message: 'objectId鍦⊿cene鍐呭繀椤诲敮涓€銆? })
      else objectIds.add(result.value.objectId)
    }
    validateContinuousLayers(value.objects, errors)
  }
  requireUtcTimestamp(value.createdAt, 'scene.createdAt', errors)
  requireUtcTimestamp(value.updatedAt, 'scene.updatedAt', errors)
  return errors.length ? failure(errors) : success(raw as SceneDocument)
}

function validateCanvas(raw: unknown, errors: ValidationIssue[]): void {
  const canvas = requireObject(raw, 'scene.canvas', errors)
  if (!canvas) return
  hasOnlyKeys(canvas, ['width', 'height', 'backgroundColor'], 'scene.canvas', errors)
  for (const dimension of ['width', 'height'] as const) {
    const size = canvas[dimension]
    if (!requireFiniteNumber(size, `scene.canvas.${dimension}`, errors) || !Number.isInteger(size) || size <= 0) {
      errors.push({ path: `scene.canvas.${dimension}`, message: '鐢诲竷灏哄蹇呴』鏄ぇ浜?鐨勬暣鏁板儚绱犮€? })
    }
  }
  if (canvas.backgroundColor !== undefined && !isValidColor(canvas.backgroundColor)) {
    errors.push({ path: 'scene.canvas.backgroundColor', message: '蹇呴』鏄悎娉曠殑绾壊鑳屾櫙瀛楃涓层€? })
  }
}

function validateContinuousLayers(objects: unknown[], errors: ValidationIssue[]): void {
  const zIndexes = objects.map((object) => isObject(object) && typeof object.zIndex === 'number' ? object.zIndex : undefined)
  for (const [index, zIndex] of zIndexes.entries()) {
    if (zIndex !== index + 1) {
      errors.push({ path: `scene.objects[${index}].zIndex`, message: 'objects蹇呴』鎸夎繛缁殑zIndex=1..N鍗囧簭淇濆瓨銆? })
      return
    }
  }
}

export function validateDraftRecord(raw: unknown): ValidationResult<DraftRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'draft', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['draftId', 'scene', 'updatedAt', 'status'], 'draft', errors)
  requireUuid(value.draftId, 'draft.draftId', errors)
  const scene = validateSceneDocument(value.scene)
  if (!scene.ok) errors.push(...scene.errors.map((issue) => ({ ...issue, path: `draft.${issue.path}` })))
  requireUtcTimestamp(value.updatedAt, 'draft.updatedAt', errors)
  if (value.status !== 'draft') errors.push({ path: 'draft.status', message: '蹇呴』鏄痙raft銆? })
  if (scene.ok && value.updatedAt !== scene.value.updatedAt) errors.push({ path: 'draft.updatedAt', message: '蹇呴』涓巗cene.updatedAt瀹屽叏涓€鑷淬€? })
  return errors.length ? failure(errors) : success(raw as DraftRecord)
}

export function validateProjectRecord(raw: unknown): ValidationResult<ProjectRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'project', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['projectId', 'projectName', 'scene', 'previewUrl', 'syncStatus', 'createdAt', 'updatedAt'], 'project', errors)
  requireUuid(value.projectId, 'project.projectId', errors)
  requireString(value.projectName, 'project.projectName', errors)
  const scene = validateSceneDocument(value.scene)
  if (!scene.ok) errors.push(...scene.errors.map((issue) => ({ ...issue, path: `project.${issue.path}` })))
  requireResourceRef(value.previewUrl, 'project.previewUrl', errors)
  if (!PROJECT_SYNC_STATUSES.includes(value.syncStatus as (typeof PROJECT_SYNC_STATUSES)[number])) errors.push({ path: 'project.syncStatus', message: '涓嶆槸鍏佽鐨勫悓姝ョ姸鎬併€? })
  requireUtcTimestamp(value.createdAt, 'project.createdAt', errors)
  const projectUpdated = requireUtcTimestamp(value.updatedAt, 'project.updatedAt', errors)
  if (scene.ok && value.projectName !== scene.value.workName) errors.push({ path: 'project.projectName', message: '蹇呴』涓巗cene.workName瀹屽叏涓€鑷淬€? })
  if (scene.ok && projectUpdated && typeof value.updatedAt === 'string' && Date.parse(value.updatedAt) < Date.parse(scene.value.updatedAt)) errors.push({ path: 'project.updatedAt', message: '涓嶅緱鏃╀簬scene.updatedAt銆? })
  return errors.length ? failure(errors) : success(raw as ProjectRecord)
}

export function validateAsrResult(raw: unknown): ValidationResult<AsrResult> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'asr', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['transcript', 'provider', 'durationMs', 'audioDurationMs', 'confidence', 'requestId'], 'asr', errors)
  requireString(value.transcript, 'asr.transcript', errors)
  if (!ASR_PROVIDERS.includes(value.provider as (typeof ASR_PROVIDERS)[number])) errors.push({ path: 'asr.provider', message: '涓嶆槸鏀寔鐨凙SR Provider銆? })
  requireNonNegativeInteger(value.durationMs, 'asr.durationMs', errors)
  if (value.audioDurationMs !== undefined) requireNonNegativeInteger(value.audioDurationMs, 'asr.audioDurationMs', errors)
  if (value.confidence !== undefined) requireFiniteNumber(value.confidence, 'asr.confidence', errors)
  requireOptionalString(value.requestId, 'asr.requestId', errors)
  return errors.length ? failure(errors) : success(raw as AsrResult)
}

export function validateQaResult(raw: unknown): ValidationResult<QaResult> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'qa', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['answer', 'requestId', 'safetyAction'], 'qa', errors)
  requireString(value.answer, 'qa.answer', errors)
  requireOptionalString(value.requestId, 'qa.requestId', errors)
  if (value.safetyAction !== undefined && !['allow', 'redirect', 'reject'].includes(value.safetyAction as string)) errors.push({ path: 'qa.safetyAction', message: '涓嶆槸鍏佽鐨勫畨鍏ㄥ鐞嗙粨鏋溿€? })
  return errors.length ? failure(errors) : success(raw as QaResult)
}

export function validateTtsResult(raw: unknown): ValidationResult<TtsResult> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'tts', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['audioUrl', 'cacheHit', 'requestId'], 'tts', errors)
  requireResourceRef(value.audioUrl, 'tts.audioUrl', errors)
  requireBoolean(value.cacheHit, 'tts.cacheHit', errors)
  requireOptionalString(value.requestId, 'tts.requestId', errors)
  return errors.length ? failure(errors) : success(raw as TtsResult)
}

export function validateSharedError(raw: unknown): ValidationResult<SharedError> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'error', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['code', 'message', 'retryable', 'requestId', 'details'], 'error', errors)
  if (!SHARED_ERROR_CODES.includes(value.code as (typeof SHARED_ERROR_CODES)[number])) errors.push({ path: 'error.code', message: '涓嶆槸鍐荤粨鐨凷haredErrorCode銆? })
  requireString(value.message, 'error.message', errors)
  requireBoolean(value.retryable, 'error.retryable', errors)
  requireOptionalString(value.requestId, 'error.requestId', errors)
  if (value.details !== undefined) {
    const details = requireObject(value.details, 'error.details', errors)
    if (details) {
      for (const [key, detail] of Object.entries(details)) {
        const isJsonPrimitive = detail === null || typeof detail === 'string' || typeof detail === 'boolean' || (typeof detail === 'number' && Number.isFinite(detail))
        if (!key.trim() || !isJsonPrimitive) {
          errors.push({ path: `error.details.${key}`, message: 'details鍙兘鍖呭惈JSON鍘熷鍊笺€? })
        }
      }
    }
  }
  return errors.length ? failure(errors) : success(raw as SharedError)
}


import { ASR_PROVIDERS, ASSET_RUNTIME_STATUSES, ASSET_TYPES, SCHEMA_VERSION } from './common'
import type { AssetAccessState, AssetRecord } from './asset'
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

/** Resource resolver supplied policy; no production protocol is frozen here. */
export interface ResourceRefValidationPolicy {
  allowedProtocols: readonly string[]
}

/** The default policy used by fixtures and unit tests. */
export const MOCK_RESOURCE_REF_POLICY: ResourceRefValidationPolicy = {
  allowedProtocols: ['mock:']
}

/** Minimal immutable snapshot index supplied by the Manifest/resource layer. */
export interface AssetSnapshotAsset {
  assetId: string
  type: 'background' | 'sticker'
}

/**
 * Non-persistent validation context. It intentionally remains outside
 * SceneDocument so saved Scene JSON has no Manifest or access-state copy.
 */
export interface SceneSnapshotValidationContext {
  snapshots: Readonly<Record<string, readonly AssetSnapshotAsset[]>>
}

type RawObject = Record<string, unknown>

const UTC_ISO_8601_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const URI_PROTOCOL = /^[a-z][a-z0-9+.-]*:$/i
const DISALLOWED_RESOURCE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'blob:', 'data:', 'javascript:'])
const SECRET_QUERY_KEYS = /(?:token|key|secret|signature|sig|password|auth)/i
const SENSITIVE_ERROR_DETAIL_KEY = /(?:token|secret|signature|sig|password|authorization|cookie|header|recording|audio|question|provider)/i
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
    if (!allowed.includes(key)) errors.push({ path: `${path}.${key}`, message: '不属于此持久化契约的字段。' })
  }
}

function requireObject(value: unknown, path: string, errors: ValidationIssue[]): RawObject | undefined {
  if (!isObject(value)) {
    errors.push({ path, message: '必须是普通对象。' })
    return undefined
  }
  return value
}

function requireString(value: unknown, path: string, errors: ValidationIssue[], allowEmpty = false): value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    errors.push({ path, message: '必须是非空字符串。' })
    return false
  }
  return true
}

function requireOptionalString(value: unknown, path: string, errors: ValidationIssue[]): value is string | undefined {
  return value === undefined || requireString(value, path, errors)
}

function requireFiniteNumber(value: unknown, path: string, errors: ValidationIssue[]): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path, message: '必须是有限数字。' })
    return false
  }
  return true
}

function requireNonNegativeInteger(value: unknown, path: string, errors: ValidationIssue[]): value is number {
  if (!requireFiniteNumber(value, path, errors)) return false
  if (!Number.isInteger(value) || value < 0) {
    errors.push({ path, message: '必须是非负整数。' })
    return false
  }
  return true
}

function requireBoolean(value: unknown, path: string, errors: ValidationIssue[]): value is boolean {
  if (typeof value !== 'boolean') {
    errors.push({ path, message: '必须是布尔值。' })
    return false
  }
  return true
}

function requireUuid(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!requireString(value, path, errors)) return false
  if (!UUID.test(value)) {
    errors.push({ path, message: '必须是 UUID 格式的随机标识。' })
    return false
  }
  return true
}

function requireUtcTimestamp(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (!requireString(value, path, errors)) return false
  if (!isUtcIso8601Timestamp(value)) {
    errors.push({ path, message: '必须是 UTC ISO8601 毫秒时间戳。' })
    return false
  }
  return true
}

/** Never throws, including for regex-matching but calendar-invalid timestamps. */
function isUtcIso8601Timestamp(value: string): boolean {
  if (!UTC_ISO_8601_MS.test(value)) return false
  try {
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
  } catch {
    return false
  }
}

/**
 * Validates a resource reference against an injected resolver policy. Without
 * a policy, only documented test fixture references using `mock:` are valid.
 */
export function isSafeResourceRef(value: unknown, policy: unknown = MOCK_RESOURCE_REF_POLICY): value is string {
  if (typeof value !== 'string' || !value.trim() || /[\\\r\n]/.test(value) || hasEncodedOrPlainPathTraversal(value)) return false
  try {
    const resource = new URL(value)
    const allowedProtocols = readAllowedProtocols(policy)
    if (!allowedProtocols.has(resource.protocol.toLowerCase()) || resource.username || resource.password || resource.hash) return false
    return ![...resource.searchParams.keys(), ...resource.searchParams.values()].some((part) => SECRET_QUERY_KEYS.test(part))
  } catch {
    return false
  }
}

function readAllowedProtocols(policy: unknown): Set<string> {
  if (!isObject(policy) || !Array.isArray(policy.allowedProtocols)) return new Set()
  const protocols = new Set<string>()
  for (const protocol of policy.allowedProtocols) {
    if (typeof protocol !== 'string') continue
    const normalized = protocol.toLowerCase()
    if (URI_PROTOCOL.test(normalized) && !DISALLOWED_RESOURCE_PROTOCOLS.has(normalized)) protocols.add(normalized)
  }
  return protocols
}

function hasEncodedOrPlainPathTraversal(value: string): boolean {
  let decoded = value
  for (let depth = 0; depth < 4; depth += 1) {
    if (/(^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)) return true
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return false
      decoded = next
    } catch {
      return true
    }
  }
  return /(^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)
}

function requireResourceRef(value: unknown, path: string, errors: ValidationIssue[], policy: unknown): value is string {
  if (!isSafeResourceRef(value, policy)) {
    errors.push({ path, message: '必须是安全、由资源解析层允许的资源引用。' })
    return false
  }
  return true
}

function requireStringArray(value: unknown, path: string, errors: ValidationIssue[]): value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    errors.push({ path, message: '必须是由非空字符串组成的数组。' })
    return false
  }
  if (new Set(value).size !== value.length) {
    errors.push({ path, message: '不得包含重复项。' })
    return false
  }
  return true
}

function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && (HEX_COLOR.test(value) || CSS_FUNCTION_COLOR.test(value) || CSS_COLOR_NAME.test(value))
}

export function validateAssetRecord(raw: unknown, resourcePolicy: unknown = MOCK_RESOURCE_REF_POLICY): ValidationResult<AssetRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'asset', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['assetId', 'type', 'themeId', 'categoryIds', 'nameZh', 'nameEn', 'introZh', 'keywords', 'imageUrl', 'thumbnailUrl', 'preSplitDataUrl', 'audio', 'source', 'license', 'contentVersion', 'status'], 'asset', errors)
  requireString(value.assetId, 'asset.assetId', errors)
  if (!ASSET_TYPES.includes(value.type as (typeof ASSET_TYPES)[number])) errors.push({ path: 'asset.type', message: '必须是 background 或 sticker。' })
  requireString(value.themeId, 'asset.themeId', errors)
  requireStringArray(value.categoryIds, 'asset.categoryIds', errors)
  requireString(value.nameZh, 'asset.nameZh', errors, true)
  requireString(value.nameEn, 'asset.nameEn', errors, true)
  requireString(value.introZh, 'asset.introZh', errors, true)
  requireStringArray(value.keywords, 'asset.keywords', errors)
  requireResourceRef(value.imageUrl, 'asset.imageUrl', errors, resourcePolicy)
  if (value.thumbnailUrl !== undefined) requireResourceRef(value.thumbnailUrl, 'asset.thumbnailUrl', errors, resourcePolicy)
  if (value.preSplitDataUrl !== undefined) {
    requireResourceRef(value.preSplitDataUrl, 'asset.preSplitDataUrl', errors, resourcePolicy)
    if (value.type !== 'sticker') errors.push({ path: 'asset.preSplitDataUrl', message: '预拆分数据只允许贴纸素材使用。' })
  }
  const audio = requireObject(value.audio, 'asset.audio', errors)
  if (audio) validateAssetAudioRefs(audio, 'asset.audio', errors, resourcePolicy)
  requireOptionalString(value.source, 'asset.source', errors)
  requireOptionalString(value.license, 'asset.license', errors)
  if (!requireFiniteNumber(value.contentVersion, 'asset.contentVersion', errors) || !Number.isInteger(value.contentVersion) || value.contentVersion < 1) {
    errors.push({ path: 'asset.contentVersion', message: '必须是大于等于 1 的整数。' })
  }
  if (!ASSET_RUNTIME_STATUSES.includes(value.status as (typeof ASSET_RUNTIME_STATUSES)[number])) errors.push({ path: 'asset.status', message: '必须是 ready 或 test_only。' })
  if (value.status === 'ready') {
    requireString(value.nameZh, 'asset.nameZh', errors)
    requireString(value.nameEn, 'asset.nameEn', errors)
    requireString(value.introZh, 'asset.introZh', errors)
  }
  return errors.length ? failure(errors) : success(raw as AssetRecord)
}

function validateAssetAudioRefs(value: RawObject, path: string, errors: ValidationIssue[], resourcePolicy: unknown): void {
  hasOnlyKeys(value, ['nameZhUrl', 'nameEnUrl', 'introZhUrl'], path, errors)
  for (const key of ['nameZhUrl', 'nameEnUrl', 'introZhUrl'] as const) {
    if (value[key] !== undefined) requireResourceRef(value[key], `${path}.${key}`, errors, resourcePolicy)
  }
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
  if (value.assetType !== 'sticker') errors.push({ path: 'sceneObject.assetType', message: '背景隐式固定在 zIndex=0，objects 只能包含贴纸。' })
  requireFiniteNumber(value.left, 'sceneObject.left', errors)
  requireFiniteNumber(value.top, 'sceneObject.top', errors)
  const scaleX = value.scaleX
  const scaleY = value.scaleY
  const hasScaleX = requireFiniteNumber(scaleX, 'sceneObject.scaleX', errors)
  const hasScaleY = requireFiniteNumber(scaleY, 'sceneObject.scaleY', errors)
  if (hasScaleX && hasScaleY && (scaleX <= 0 || scaleY <= 0 || scaleX !== scaleY)) {
    errors.push({ path: 'sceneObject.scaleX', message: 'V1 只支持大于 0 的等比例缩放。' })
  }
  if (requireFiniteNumber(value.angle, 'sceneObject.angle', errors) && (value.angle < -180 || value.angle >= 180)) {
    errors.push({ path: 'sceneObject.angle', message: '角度必须规范化到 [-180, 180)。' })
  }
  if (!requireFiniteNumber(value.zIndex, 'sceneObject.zIndex', errors) || !Number.isInteger(value.zIndex) || value.zIndex < 1) {
    errors.push({ path: 'sceneObject.zIndex', message: '贴纸 zIndex 必须为从 1 开始的整数。' })
  }
  const visible = requireBoolean(value.visible, 'sceneObject.visible', errors)
  requireBoolean(value.locked, 'sceneObject.locked', errors)
  if (visible && value.visible !== true) errors.push({ path: 'sceneObject.visible', message: 'V1 持久化贴纸必须可见。' })
  return errors.length ? failure(errors) : success(raw as SceneObject)
}

export function validateSceneDocument(raw: unknown): ValidationResult<SceneDocument> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'scene', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['schemaVersion', 'sceneId', 'userId', 'workName', 'themeId', 'assetSnapshotId', 'canvas', 'backgroundAssetId', 'objects', 'createdAt', 'updatedAt'], 'scene', errors)
  if (value.schemaVersion !== SCHEMA_VERSION) errors.push({ path: 'scene.schemaVersion', message: '不支持的 Scene schemaVersion。' })
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
    errors.push({ path: 'scene.objects', message: '必须是对象数组。' })
  } else {
    const objectIds = new Set<string>()
    for (const [index, object] of value.objects.entries()) {
      const result = validateSceneObject(object)
      if (!result.ok) errors.push(...result.errors.map((issue) => ({ ...issue, path: `scene.objects[${index}].${issue.path.replace(/^sceneObject\./, '')}` })))
      else if (objectIds.has(result.value.objectId)) errors.push({ path: `scene.objects[${index}].objectId`, message: 'objectId 在 Scene 内必须唯一。' })
      else objectIds.add(result.value.objectId)
    }
    validateContinuousLayers(value.objects, errors)
  }
  requireUtcTimestamp(value.createdAt, 'scene.createdAt', errors)
  requireUtcTimestamp(value.updatedAt, 'scene.updatedAt', errors)
  return errors.length ? failure(errors) : success(raw as SceneDocument)
}

/** Validates the non-persistent Manifest snapshot context before Scene lookup. */
export function validateSceneSnapshotValidationContext(raw: unknown): ValidationResult<SceneSnapshotValidationContext> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'snapshotContext', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['snapshots'], 'snapshotContext', errors)
  const snapshots = requireObject(value.snapshots, 'snapshotContext.snapshots', errors)
  if (!snapshots) return failure(errors)

  for (const [snapshotId, assets] of Object.entries(snapshots)) {
    if (!snapshotId.trim()) errors.push({ path: 'snapshotContext.snapshots', message: '快照索引不能包含空快照 ID。' })
    if (!Array.isArray(assets)) {
      errors.push({ path: `snapshotContext.snapshots.${snapshotId}`, message: '快照素材必须是数组。' })
      continue
    }
    const assetIds = new Set<string>()
    for (const [index, asset] of assets.entries()) {
      const entry = requireObject(asset, `snapshotContext.snapshots.${snapshotId}[${index}]`, errors)
      if (!entry) continue
      hasOnlyKeys(entry, ['assetId', 'type'], `snapshotContext.snapshots.${snapshotId}[${index}]`, errors)
      const assetId = entry.assetId
      const hasAssetId = requireString(assetId, `snapshotContext.snapshots.${snapshotId}[${index}].assetId`, errors)
      if (!ASSET_TYPES.includes(entry.type as (typeof ASSET_TYPES)[number])) errors.push({ path: `snapshotContext.snapshots.${snapshotId}[${index}].type`, message: '必须是 background 或 sticker。' })
      if (hasAssetId && assetIds.has(assetId)) errors.push({ path: `snapshotContext.snapshots.${snapshotId}[${index}].assetId`, message: '同一快照内 assetId 必须唯一。' })
      if (hasAssetId) assetIds.add(assetId)
    }
  }
  return errors.length ? failure(errors) : success(raw as SceneSnapshotValidationContext)
}

/**
 * Verifies a structurally valid Scene against the exact immutable asset
 * snapshot selected by assetSnapshotId, without adding fields to SceneDocument.
 */
export function validateSceneDocumentAgainstSnapshot(raw: unknown, snapshotContext: unknown): ValidationResult<SceneDocument> {
  const scene = validateSceneDocument(raw)
  if (!scene.ok) return scene
  const context = validateSceneSnapshotValidationContext(snapshotContext)
  if (!context.ok) return failure(context.errors)

  const snapshots = context.value.snapshots
  const snapshotId = scene.value.assetSnapshotId
  if (!Object.prototype.hasOwnProperty.call(snapshots, snapshotId)) {
    return failure([{ path: 'scene.assetSnapshotId', message: '引用的素材快照不存在。' }])
  }
  const snapshotsById = new Map<string, readonly AssetSnapshotAsset[]>(
    Object.entries(snapshots).filter((entry): entry is [string, readonly AssetSnapshotAsset[]] => Array.isArray(entry[1]))
  )
  const snapshotAssets = snapshotsById.get(snapshotId)
  if (!Array.isArray(snapshotAssets)) {
    return failure([{ path: 'scene.assetSnapshotId', message: '引用的素材快照无效。' }])
  }
  const assetsById = new Map(snapshotAssets.map((asset) => [asset.assetId, asset]))
  const errors: ValidationIssue[] = []

  if (scene.value.backgroundAssetId !== null) {
    const background = assetsById.get(scene.value.backgroundAssetId)
    if (!background) errors.push({ path: 'scene.backgroundAssetId', message: '背景素材不属于引用的素材快照。' })
    else if (background.type !== 'background') errors.push({ path: 'scene.backgroundAssetId', message: '背景素材必须是 background 类型。' })
  }

  for (const [index, object] of scene.value.objects.entries()) {
    const asset = assetsById.get(object.assetId)
    if (!asset) errors.push({ path: `scene.objects[${index}].assetId`, message: '贴纸素材不属于引用的素材快照。' })
    else if (asset.type !== 'sticker') errors.push({ path: `scene.objects[${index}].assetId`, message: '贴纸素材必须是 sticker 类型。' })
  }
  return errors.length ? failure(errors) : scene
}

function validateCanvas(raw: unknown, errors: ValidationIssue[]): void {
  const canvas = requireObject(raw, 'scene.canvas', errors)
  if (!canvas) return
  hasOnlyKeys(canvas, ['width', 'height', 'backgroundColor'], 'scene.canvas', errors)
  for (const dimension of ['width', 'height'] as const) {
    const size = canvas[dimension]
    if (!requireFiniteNumber(size, `scene.canvas.${dimension}`, errors) || !Number.isInteger(size) || size <= 0) {
      errors.push({ path: `scene.canvas.${dimension}`, message: '画布尺寸必须是大于 0 的整数像素。' })
    }
  }
  if (canvas.backgroundColor !== undefined && !isValidColor(canvas.backgroundColor)) {
    errors.push({ path: 'scene.canvas.backgroundColor', message: '必须是合法的纯色背景字符串。' })
  }
}

function validateContinuousLayers(objects: unknown[], errors: ValidationIssue[]): void {
  const zIndexes = objects.map((object) => isObject(object) && typeof object.zIndex === 'number' ? object.zIndex : undefined)
  for (const [index, zIndex] of zIndexes.entries()) {
    if (zIndex !== index + 1) {
      errors.push({ path: `scene.objects[${index}].zIndex`, message: 'objects 必须按连续的 zIndex=1..N 升序保存。' })
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
  if (value.status !== 'draft') errors.push({ path: 'draft.status', message: '必须是 draft。' })
  if (scene.ok && value.updatedAt !== scene.value.updatedAt) errors.push({ path: 'draft.updatedAt', message: '必须与 scene.updatedAt 完全一致。' })
  return errors.length ? failure(errors) : success(raw as DraftRecord)
}

export function validateProjectRecord(raw: unknown, resourcePolicy: unknown = MOCK_RESOURCE_REF_POLICY): ValidationResult<ProjectRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'project', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['projectId', 'projectName', 'scene', 'previewUrl', 'syncStatus', 'createdAt', 'updatedAt'], 'project', errors)
  requireUuid(value.projectId, 'project.projectId', errors)
  requireString(value.projectName, 'project.projectName', errors)
  const scene = validateSceneDocument(value.scene)
  if (!scene.ok) errors.push(...scene.errors.map((issue) => ({ ...issue, path: `project.${issue.path}` })))
  requireResourceRef(value.previewUrl, 'project.previewUrl', errors, resourcePolicy)
  if (!PROJECT_SYNC_STATUSES.includes(value.syncStatus as (typeof PROJECT_SYNC_STATUSES)[number])) errors.push({ path: 'project.syncStatus', message: '不是允许的同步状态。' })
  requireUtcTimestamp(value.createdAt, 'project.createdAt', errors)
  const projectUpdated = requireUtcTimestamp(value.updatedAt, 'project.updatedAt', errors)
  if (scene.ok && value.projectName !== scene.value.workName) errors.push({ path: 'project.projectName', message: '必须与 scene.workName 完全一致。' })
  if (scene.ok && projectUpdated && typeof value.updatedAt === 'string' && Date.parse(value.updatedAt) < Date.parse(scene.value.updatedAt)) errors.push({ path: 'project.updatedAt', message: '不得早于 scene.updatedAt。' })
  return errors.length ? failure(errors) : success(raw as ProjectRecord)
}

export function validateAsrResult(raw: unknown): ValidationResult<AsrResult> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'asr', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['transcript', 'provider', 'durationMs', 'audioDurationMs', 'confidence', 'requestId'], 'asr', errors)
  requireString(value.transcript, 'asr.transcript', errors)
  if (!ASR_PROVIDERS.includes(value.provider as (typeof ASR_PROVIDERS)[number])) errors.push({ path: 'asr.provider', message: '不是支持的 ASR Provider。' })
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
  if (value.safetyAction !== undefined && !['allow', 'redirect', 'reject'].includes(value.safetyAction as string)) errors.push({ path: 'qa.safetyAction', message: '不是允许的安全处理结果。' })
  return errors.length ? failure(errors) : success(raw as QaResult)
}

export function validateTtsResult(raw: unknown, resourcePolicy: unknown = MOCK_RESOURCE_REF_POLICY): ValidationResult<TtsResult> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'tts', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['audioUrl', 'cacheHit', 'requestId'], 'tts', errors)
  requireResourceRef(value.audioUrl, 'tts.audioUrl', errors, resourcePolicy)
  requireBoolean(value.cacheHit, 'tts.cacheHit', errors)
  requireOptionalString(value.requestId, 'tts.requestId', errors)
  return errors.length ? failure(errors) : success(raw as TtsResult)
}

export function validateSharedError(raw: unknown): ValidationResult<SharedError> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'error', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['code', 'message', 'retryable', 'requestId', 'details'], 'error', errors)
  if (!SHARED_ERROR_CODES.includes(value.code as (typeof SHARED_ERROR_CODES)[number])) errors.push({ path: 'error.code', message: '不是冻结的 SharedErrorCode。' })
  requireString(value.message, 'error.message', errors)
  requireBoolean(value.retryable, 'error.retryable', errors)
  requireOptionalString(value.requestId, 'error.requestId', errors)
  if (value.details !== undefined) {
    const details = requireObject(value.details, 'error.details', errors)
    if (details) {
      for (const [key, detail] of Object.entries(details)) {
        const isJsonPrimitive = detail === null || typeof detail === 'string' || typeof detail === 'boolean' || (typeof detail === 'number' && Number.isFinite(detail))
        if (!key.trim() || SENSITIVE_ERROR_DETAIL_KEY.test(key) || !isJsonPrimitive) {
          errors.push({ path: `error.details.${key}`, message: 'details 只能包含安全的 JSON 原始值。' })
        }
      }
    }
  }
  return errors.length ? failure(errors) : success(raw as SharedError)
}


import {
  ASR_PROVIDERS,
  ASSET_RUNTIME_STATUSES,
  ASSET_TYPES,
  SCHEMA_VERSION
} from './common'
import type { AssetAccessState, AssetRecord } from './asset'
import type { AsrResult, QaResult, TtsResult } from './ai'
import { SHARED_ERROR_CODES } from './error'
import type { SharedError } from './error'
import { PROJECT_SYNC_STATUSES } from './project'
import type { DraftRecord, ProjectRecord } from './project'
import { PERSONAL_ASSET_ROLES, PERSONAL_ASSET_SOURCE_TYPES } from './personal-asset'
import type { PersonalAssetRecord, PersonalAssetVersionRecord } from './personal-asset'
import {
  DEFAULT_BACKGROUND_CONSTRAINTS,
  DEFAULT_CORE_PATTERN_CONSTRAINTS,
  DEFAULT_ELEMENT_CONSTRAINTS,
  FELT_COMMON_STYLE_CONSTRAINTS,
  GENERATION_CONFIRMATION_STATUSES,
  GENERATION_CREATION_MODES,
  GENERATION_SPEC_POLLUTION_KEYS,
  GENERATION_SPEC_SCHEMA_VERSION,
  HARD_CLARIFICATION_MAX_ROUNDS,
  type CommonStyleConstraints,
  type GenerationContentSpec,
  type GenerationSpec,
  type GenerationSubject,
  type RoleConstraints
} from './generation-spec'
import type {
  SceneCorePatternObject,
  SceneDocument,
  SceneObject,
  ScenePersonalBackground,
  ScenePersonalElement,
  ScenePersonalObject
} from './scene'

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

/**
 * Non-persistent Personal Asset lookup context for Scene cross-table checks.
 * Personal Asset rows are deliberately not copied into SceneDocument.
 */
export interface ScenePersonalAssetValidationContext {
  personalAssets: readonly PersonalAssetRecord[]
  personalAssetVersions: readonly PersonalAssetVersionRecord[]
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

export function validatePersonalAssetRecord(raw: unknown): ValidationResult<PersonalAssetRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'personalAsset', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['personalAssetId', 'userId', 'role', 'sourceType', 'name', 'currentVersionId', 'createdAt', 'updatedAt'], 'personalAsset', errors)
  requireUuid(value.personalAssetId, 'personalAsset.personalAssetId', errors)
  requireString(value.userId, 'personalAsset.userId', errors)
  if (!PERSONAL_ASSET_ROLES.includes(value.role as (typeof PERSONAL_ASSET_ROLES)[number])) {
    errors.push({ path: 'personalAsset.role', message: '必须是 core_pattern、element 或 background。' })
  }
  if (!PERSONAL_ASSET_SOURCE_TYPES.includes(value.sourceType as (typeof PERSONAL_ASSET_SOURCE_TYPES)[number])) {
    errors.push({ path: 'personalAsset.sourceType', message: '必须是 ai_generated、uploaded 或 hand_drawn。' })
  }
  requireString(value.name, 'personalAsset.name', errors)
  requireUuid(value.currentVersionId, 'personalAsset.currentVersionId', errors)
  requireUtcTimestamp(value.createdAt, 'personalAsset.createdAt', errors)
  requireUtcTimestamp(value.updatedAt, 'personalAsset.updatedAt', errors)
  return errors.length ? failure(errors) : success(raw as PersonalAssetRecord)
}

export function validatePersonalAssetVersionRecord(
  raw: unknown,
  resourcePolicy: unknown = MOCK_RESOURCE_REF_POLICY
): ValidationResult<PersonalAssetVersionRecord> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'personalAssetVersion', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['versionId', 'personalAssetId', 'versionNumber', 'sourceImageRef', 'parentVersionId', 'createdAt'], 'personalAssetVersion', errors)
  requireUuid(value.versionId, 'personalAssetVersion.versionId', errors)
  requireUuid(value.personalAssetId, 'personalAssetVersion.personalAssetId', errors)
  const versionNumber = value.versionNumber
  const hasVersionNumber = requireFiniteNumber(versionNumber, 'personalAssetVersion.versionNumber', errors)
  if (hasVersionNumber && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
    errors.push({ path: 'personalAssetVersion.versionNumber', message: '必须是大于等于 1 的整数。' })
  }
  requireResourceRef(value.sourceImageRef, 'personalAssetVersion.sourceImageRef', errors, resourcePolicy)
  if (value.parentVersionId !== null) requireUuid(value.parentVersionId, 'personalAssetVersion.parentVersionId', errors)
  if (value.versionId === value.parentVersionId) {
    errors.push({ path: 'personalAssetVersion.parentVersionId', message: '不得引用自身作为父版本。' })
  }
  if (hasVersionNumber && versionNumber === 1 && value.parentVersionId !== null) {
    errors.push({ path: 'personalAssetVersion.parentVersionId', message: '第一版的 parentVersionId 必须为 null。' })
  }
  if (hasVersionNumber && versionNumber > 1 && value.parentVersionId === null) {
    errors.push({ path: 'personalAssetVersion.parentVersionId', message: '后续版本必须引用上一版。' })
  }
  requireUtcTimestamp(value.createdAt, 'personalAssetVersion.createdAt', errors)
  return errors.length ? failure(errors) : success(raw as PersonalAssetVersionRecord)
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

export function validateScenePersonalBackground(raw: unknown): ValidationResult<ScenePersonalBackground> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'scenePersonalBackground', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['personalAssetId', 'versionId'], 'scenePersonalBackground', errors)
  requireUuid(value.personalAssetId, 'scenePersonalBackground.personalAssetId', errors)
  requireUuid(value.versionId, 'scenePersonalBackground.versionId', errors)
  return errors.length ? failure(errors) : success(raw as ScenePersonalBackground)
}

function validateScenePersonalTransformBase(raw: unknown): ValidationResult<ScenePersonalObject> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'scenePersonalObject', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['objectId', 'personalAssetId', 'versionId', 'left', 'top', 'scaleX', 'scaleY', 'angle', 'visible', 'locked'], 'scenePersonalObject', errors)
  requireUuid(value.objectId, 'scenePersonalObject.objectId', errors)
  requireUuid(value.personalAssetId, 'scenePersonalObject.personalAssetId', errors)
  requireUuid(value.versionId, 'scenePersonalObject.versionId', errors)
  requireFiniteNumber(value.left, 'scenePersonalObject.left', errors)
  requireFiniteNumber(value.top, 'scenePersonalObject.top', errors)
  if (!requireFiniteNumber(value.scaleX, 'scenePersonalObject.scaleX', errors) || value.scaleX <= 0) {
    errors.push({ path: 'scenePersonalObject.scaleX', message: '必须是大于 0 的有限数字。' })
  }
  if (!requireFiniteNumber(value.scaleY, 'scenePersonalObject.scaleY', errors) || value.scaleY <= 0) {
    errors.push({ path: 'scenePersonalObject.scaleY', message: '必须是大于 0 的有限数字。' })
  }
  if (requireFiniteNumber(value.angle, 'scenePersonalObject.angle', errors) && (value.angle < -180 || value.angle >= 180)) {
    errors.push({ path: 'scenePersonalObject.angle', message: '角度必须规范化到 [-180, 180)。' })
  }
  requireBoolean(value.visible, 'scenePersonalObject.visible', errors)
  requireBoolean(value.locked, 'scenePersonalObject.locked', errors)
  return errors.length ? failure(errors) : success(raw as ScenePersonalObject)
}

export function validateSceneCorePatternObject(raw: unknown): ValidationResult<SceneCorePatternObject> {
  return validateScenePersonalTransformBase(raw)
}

export function validateScenePersonalElement(raw: unknown): ValidationResult<ScenePersonalElement> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'scenePersonalElement', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['objectId', 'personalAssetId', 'versionId', 'left', 'top', 'scaleX', 'scaleY', 'angle', 'zIndex', 'visible', 'locked'], 'scenePersonalElement', errors)
  requireUuid(value.objectId, 'scenePersonalElement.objectId', errors)
  requireUuid(value.personalAssetId, 'scenePersonalElement.personalAssetId', errors)
  requireUuid(value.versionId, 'scenePersonalElement.versionId', errors)
  requireFiniteNumber(value.left, 'scenePersonalElement.left', errors)
  requireFiniteNumber(value.top, 'scenePersonalElement.top', errors)
  if (!requireFiniteNumber(value.scaleX, 'scenePersonalElement.scaleX', errors) || value.scaleX <= 0) {
    errors.push({ path: 'scenePersonalElement.scaleX', message: '必须是大于 0 的有限数字。' })
  }
  if (!requireFiniteNumber(value.scaleY, 'scenePersonalElement.scaleY', errors) || value.scaleY <= 0) {
    errors.push({ path: 'scenePersonalElement.scaleY', message: '必须是大于 0 的有限数字。' })
  }
  if (requireFiniteNumber(value.angle, 'scenePersonalElement.angle', errors) && (value.angle < -180 || value.angle >= 180)) {
    errors.push({ path: 'scenePersonalElement.angle', message: '角度必须规范化到 [-180, 180)。' })
  }
  if (!requireFiniteNumber(value.zIndex, 'scenePersonalElement.zIndex', errors) || !Number.isInteger(value.zIndex) || value.zIndex < 1) {
    errors.push({ path: 'scenePersonalElement.zIndex', message: '个人元素 zIndex 必须为从 1 开始的整数。' })
  }
  requireBoolean(value.visible, 'scenePersonalElement.visible', errors)
  requireBoolean(value.locked, 'scenePersonalElement.locked', errors)
  return errors.length ? failure(errors) : success(raw as ScenePersonalElement)
}

/** @deprecated Use validateSceneCorePatternObject for the zIndex-free shape. */
export function validateScenePersonalObject(raw: unknown): ValidationResult<ScenePersonalObject> {
  return validateScenePersonalTransformBase(raw)
}

export function validateSceneDocument(raw: unknown): ValidationResult<SceneDocument> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'scene', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['schemaVersion', 'sceneId', 'userId', 'workName', 'themeId', 'assetSnapshotId', 'canvas', 'backgroundAssetId', 'objects', 'personalBackground', 'corePattern', 'personalElements', 'createdAt', 'updatedAt'], 'scene', errors)
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
  if (value.personalBackground === null) {
    // null is the explicit no-personal-background state.
  } else {
    const personalBackground = validateScenePersonalBackground(value.personalBackground)
    if (!personalBackground.ok) errors.push(...personalBackground.errors.map((issue) => ({ ...issue, path: `scene.personalBackground.${issue.path.replace(/^scenePersonalBackground\.?/, '')}` })))
  }
  if (value.backgroundAssetId !== null && value.personalBackground !== null) {
    errors.push({ path: 'scene.personalBackground', message: '系统背景与个人背景不能同时存在。' })
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
  }
  const objectIds = new Set<string>()
  if (Array.isArray(value.objects)) {
    for (const object of value.objects) {
      if (isObject(object) && typeof object.objectId === 'string') objectIds.add(object.objectId)
    }
  }
  if (value.corePattern === null) {
    // null is the explicit no-core-pattern state.
  } else {
    const corePattern = validateSceneCorePatternObject(value.corePattern)
    if (!corePattern.ok) errors.push(...corePattern.errors.map((issue) => ({ ...issue, path: `scene.corePattern.${issue.path.replace(/^scenePersonalObject\.?/, '')}` })))
    else if (objectIds.has(corePattern.value.objectId)) errors.push({ path: 'scene.corePattern.objectId', message: 'objectId 在 Scene 内必须唯一。' })
    else objectIds.add(corePattern.value.objectId)
  }
  if (!Array.isArray(value.personalElements)) {
    errors.push({ path: 'scene.personalElements', message: '必须是对象数组。' })
  } else {
    for (const [index, object] of value.personalElements.entries()) {
      const personalObject = validateScenePersonalElement(object)
      if (!personalObject.ok) {
        errors.push(...personalObject.errors.map((issue) => ({ ...issue, path: `scene.personalElements[${index}].${issue.path.replace(/^scenePersonalElement\.?/, '')}` })))
      } else if (objectIds.has(personalObject.value.objectId)) {
        errors.push({ path: `scene.personalElements[${index}].objectId`, message: 'objectId 在 Scene 内必须唯一。' })
      } else {
        objectIds.add(personalObject.value.objectId)
      }
    }
  }
  if (Array.isArray(value.objects) && Array.isArray(value.personalElements)) {
    validateGlobalElementLayers(value.objects, value.personalElements, errors)
  }
  requireUtcTimestamp(value.createdAt, 'scene.createdAt', errors)
  requireUtcTimestamp(value.updatedAt, 'scene.updatedAt', errors)
  return errors.length ? failure(errors) : success(raw as SceneDocument)
}

/** Validates the lookup rows used for Scene Personal Asset cross-table checks. */
export function validateScenePersonalAssetValidationContext(
  raw: unknown,
  resourcePolicy: unknown = MOCK_RESOURCE_REF_POLICY
): ValidationResult<ScenePersonalAssetValidationContext> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'personalAssetContext', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, ['personalAssets', 'personalAssetVersions'], 'personalAssetContext', errors)

  const assets = value.personalAssets
  if (!Array.isArray(assets)) {
    errors.push({ path: 'personalAssetContext.personalAssets', message: '必须是 PersonalAssetRecord 数组。' })
  } else {
    const assetIds = new Set<string>()
    for (const [index, asset] of assets.entries()) {
      const result = validatePersonalAssetRecord(asset)
      if (!result.ok) {
        errors.push(...result.errors.map((issue) => ({ ...issue, path: `personalAssetContext.personalAssets[${index}].${issue.path.replace(/^personalAsset\.?/, '')}` })))
      } else if (assetIds.has(result.value.personalAssetId)) {
        errors.push({ path: `personalAssetContext.personalAssets[${index}].personalAssetId`, message: 'personalAssetId 必须唯一。' })
      } else {
        assetIds.add(result.value.personalAssetId)
      }
    }
  }

  const versions = value.personalAssetVersions
  if (!Array.isArray(versions)) {
    errors.push({ path: 'personalAssetContext.personalAssetVersions', message: '必须是 PersonalAssetVersionRecord 数组。' })
  } else {
    const versionIds = new Set<string>()
    for (const [index, version] of versions.entries()) {
      const result = validatePersonalAssetVersionRecord(version, resourcePolicy)
      if (!result.ok) {
        errors.push(...result.errors.map((issue) => ({ ...issue, path: `personalAssetContext.personalAssetVersions[${index}].${issue.path.replace(/^personalAssetVersion\.?/, '')}` })))
      } else if (versionIds.has(result.value.versionId)) {
        errors.push({ path: `personalAssetContext.personalAssetVersions[${index}].versionId`, message: 'versionId 必须唯一。' })
      } else {
        versionIds.add(result.value.versionId)
      }
    }
  }

  return errors.length ? failure(errors) : success(raw as ScenePersonalAssetValidationContext)
}

/**
 * Validates Scene Personal Asset references against a non-persistent lookup
 * context. Historical versions are valid; only version ownership is checked.
 */
export function validateSceneDocumentAgainstPersonalAssets(
  raw: unknown,
  contextRaw: unknown,
  resourcePolicy: unknown = MOCK_RESOURCE_REF_POLICY
): ValidationResult<SceneDocument> {
  const scene = validateSceneDocument(raw)
  if (!scene.ok) return scene
  const context = validateScenePersonalAssetValidationContext(contextRaw, resourcePolicy)
  if (!context.ok) return failure(context.errors)

  const assetsById = new Map(context.value.personalAssets.map((asset) => [asset.personalAssetId, asset]))
  const versionsById = new Map(context.value.personalAssetVersions.map((version) => [version.versionId, version]))
  const errors: ValidationIssue[] = []

  const validateReference = (
    reference: { personalAssetId: string; versionId: string },
    path: string,
    expectedRole: (typeof PERSONAL_ASSET_ROLES)[number]
  ): void => {
    const asset = assetsById.get(reference.personalAssetId)
    if (!asset) {
      errors.push({ path: `${path}.personalAssetId`, message: '引用的 Personal Asset 不存在。' })
    } else {
      if (asset.role !== expectedRole) errors.push({ path: `${path}.personalAssetId`, message: `Personal Asset role 必须是 ${expectedRole}。` })
      if (asset.userId !== scene.value.userId) errors.push({ path: `${path}.personalAssetId`, message: 'Personal Asset 不属于当前 Scene 用户。' })
    }

    const version = versionsById.get(reference.versionId)
    if (!version) {
      errors.push({ path: `${path}.versionId`, message: '引用的 Personal Asset Version 不存在。' })
    } else if (version.personalAssetId !== reference.personalAssetId) {
      errors.push({ path: `${path}.versionId`, message: 'Personal Asset Version 不属于引用的 Personal Asset。' })
    }
  }

  if (scene.value.personalBackground !== null) {
    validateReference(scene.value.personalBackground, 'scene.personalBackground', 'background')
  }
  if (scene.value.corePattern !== null) {
    validateReference(scene.value.corePattern, 'scene.corePattern', 'core_pattern')
  }
  scene.value.personalElements.forEach((element, index) => {
    validateReference(element, `scene.personalElements[${index}]`, 'element')
  })

  return errors.length ? failure(errors) : scene
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

function validateGlobalElementLayers(
  objects: unknown[],
  personalElements: unknown[],
  errors: ValidationIssue[]
): void {
  const entries: Array<{ zIndex: number; path: string }> = []
  objects.forEach((object, index) => {
    if (isObject(object) && typeof object.zIndex === 'number' && Number.isInteger(object.zIndex) && object.zIndex >= 1) {
      entries.push({ zIndex: object.zIndex, path: `scene.objects[${index}].zIndex` })
    }
  })
  personalElements.forEach((object, index) => {
    if (isObject(object) && typeof object.zIndex === 'number' && Number.isInteger(object.zIndex) && object.zIndex >= 1) {
      entries.push({ zIndex: object.zIndex, path: `scene.personalElements[${index}].zIndex` })
    }
  })
  entries.sort((left, right) => left.zIndex - right.zIndex)
  for (const [index, entry] of entries.entries()) {
    if (entry.zIndex !== index + 1) {
      errors.push({ path: entry.path, message: '系统贴纸与个人元素必须共享连续且唯一的全局 zIndex=1..N。' })
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

const GENERATION_SPEC_KEYS = [
  'schemaVersion',
  'assetRole',
  'creationMode',
  'themeContext',
  'content',
  'roleConstraints',
  'styleConstraints',
  'clarification',
  'confirmation'
] as const

const CONTENT_KEYS = [
  'primarySubjects',
  'actionOrRelationship',
  'preferredColors',
  'requiredElements',
  'forbiddenElements',
  'environmentDescription'
] as const

function rejectPollution(value: RawObject, path: string, errors: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if ((GENERATION_SPEC_POLLUTION_KEYS as readonly string[]).includes(key)) {
      errors.push({ path: `${path}.${key}`, message: '不得写入 Prompt 或 Provider 字段。' })
    }
  }
}

function requireShortString(value: unknown, path: string, errors: ValidationIssue[], maxLength: number): value is string {
  if (!requireString(value, path, errors)) return false
  if (value.length > maxLength) {
    errors.push({ path, message: `不能超过 ${maxLength} 个字符。` })
    return false
  }
  return true
}

function requireStringList(value: unknown, path: string, errors: ValidationIssue[], maxItems: number, maxLength: number): void {
  if (!Array.isArray(value)) {
    errors.push({ path, message: '必须是字符串数组。' })
    return
  }
  if (value.length > maxItems) errors.push({ path, message: `不能超过 ${maxItems} 项。` })
  for (const [index, item] of value.entries()) {
    requireShortString(item, `${path}[${index}]`, errors, maxLength)
  }
}

function validateGenerationSubject(raw: unknown, path: string, errors: ValidationIssue[]): void {
  const value = requireObject(raw, path, errors)
  if (!value) return
  hasOnlyKeys(value, ['name', 'count', 'attributes'], path, errors)
  rejectPollution(value, path, errors)
  requireShortString(value.name, `${path}.name`, errors, 40)
  if (value.count !== undefined) {
    if (!requireFiniteNumber(value.count, `${path}.count`, errors) || !Number.isInteger(value.count) || value.count < 1 || value.count > 8) {
      errors.push({ path: `${path}.count`, message: '必须是 1 到 8 的整数。' })
    }
  }
  if (value.attributes !== undefined) requireStringList(value.attributes, `${path}.attributes`, errors, 8, 24)
}

function validateGenerationContent(raw: unknown, errors: ValidationIssue[]): void {
  const value = requireObject(raw, 'generationSpec.content', errors)
  if (!value) return
  hasOnlyKeys(value, CONTENT_KEYS, 'generationSpec.content', errors)
  rejectPollution(value, 'generationSpec.content', errors)
  if (!Array.isArray(value.primarySubjects)) {
    errors.push({ path: 'generationSpec.content.primarySubjects', message: '必须是主体数组。' })
  } else {
    if (value.primarySubjects.length > 8) {
      errors.push({ path: 'generationSpec.content.primarySubjects', message: '不能超过 8 个主体。' })
    }
    for (const [index, subject] of value.primarySubjects.entries()) {
      validateGenerationSubject(subject, `generationSpec.content.primarySubjects[${index}]`, errors)
    }
  }
  if (value.actionOrRelationship !== undefined) {
    requireShortString(value.actionOrRelationship, 'generationSpec.content.actionOrRelationship', errors, 80)
  }
  if (value.preferredColors !== undefined) {
    requireStringList(value.preferredColors, 'generationSpec.content.preferredColors', errors, 8, 24)
  }
  if (value.requiredElements !== undefined) {
    requireStringList(value.requiredElements, 'generationSpec.content.requiredElements', errors, 8, 40)
  }
  if (value.forbiddenElements !== undefined) {
    requireStringList(value.forbiddenElements, 'generationSpec.content.forbiddenElements', errors, 8, 40)
  }
  if (value.environmentDescription !== undefined) {
    requireShortString(value.environmentDescription, 'generationSpec.content.environmentDescription', errors, 80)
  }
}

function sameStyle(value: unknown): value is CommonStyleConstraints {
  if (!isObject(value)) return false
  return (Object.keys(FELT_COMMON_STYLE_CONSTRAINTS) as Array<keyof CommonStyleConstraints>).every(
    (key) => value[key] === FELT_COMMON_STYLE_CONSTRAINTS[key]
  )
}

function validateRoleConstraints(raw: unknown, assetRole: unknown, errors: ValidationIssue[]): void {
  const value = requireObject(raw, 'generationSpec.roleConstraints', errors)
  if (!value) return
  rejectPollution(value, 'generationSpec.roleConstraints', errors)
  if (value.role !== assetRole) {
    errors.push({ path: 'generationSpec.roleConstraints.role', message: '必须与 assetRole 一致。' })
  }
  const expected =
    assetRole === 'element'
      ? DEFAULT_ELEMENT_CONSTRAINTS
      : assetRole === 'background'
        ? DEFAULT_BACKGROUND_CONSTRAINTS
        : DEFAULT_CORE_PATTERN_CONSTRAINTS
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      errors.push({ path: `generationSpec.roleConstraints.${key}`, message: '角色约束必须使用项目默认值。' })
    }
  }
}

export function validateGenerationSpec(raw: unknown): ValidationResult<GenerationSpec> {
  const errors: ValidationIssue[] = []
  const value = requireObject(raw, 'generationSpec', errors)
  if (!value) return failure(errors)
  hasOnlyKeys(value, GENERATION_SPEC_KEYS, 'generationSpec', errors)
  rejectPollution(value, 'generationSpec', errors)
  if (value.schemaVersion !== GENERATION_SPEC_SCHEMA_VERSION) {
    errors.push({ path: 'generationSpec.schemaVersion', message: '必须是 GenerationSpec schemaVersion 1。' })
  }
  if (!PERSONAL_ASSET_ROLES.includes(value.assetRole as (typeof PERSONAL_ASSET_ROLES)[number])) {
    errors.push({ path: 'generationSpec.assetRole', message: '必须是 core_pattern、element 或 background。' })
  }
  if (!GENERATION_CREATION_MODES.includes(value.creationMode as (typeof GENERATION_CREATION_MODES)[number])) {
    errors.push({ path: 'generationSpec.creationMode', message: '必须是 guided 或 free。' })
  }
  if (value.themeContext !== undefined) {
    const theme = requireObject(value.themeContext, 'generationSpec.themeContext', errors)
    if (theme) {
      hasOnlyKeys(theme, ['themeId'], 'generationSpec.themeContext', errors)
      if (theme.themeId !== undefined) requireShortString(theme.themeId, 'generationSpec.themeContext.themeId', errors, 64)
    }
  }
  validateGenerationContent(value.content, errors)
  validateRoleConstraints(value.roleConstraints, value.assetRole, errors)
  if (!sameStyle(value.styleConstraints)) {
    errors.push({ path: 'generationSpec.styleConstraints', message: '必须使用项目固定 FeltStyleSpec，不能改基础画风。' })
  }
  const clarification = requireObject(value.clarification, 'generationSpec.clarification', errors)
  if (clarification) {
    hasOnlyKeys(clarification, ['roundCount', 'askedFields', 'pendingField'], 'generationSpec.clarification', errors)
    if (
      !requireFiniteNumber(clarification.roundCount, 'generationSpec.clarification.roundCount', errors) ||
      !Number.isInteger(clarification.roundCount) ||
      clarification.roundCount < 0 ||
      clarification.roundCount > HARD_CLARIFICATION_MAX_ROUNDS
    ) {
      errors.push({ path: 'generationSpec.clarification.roundCount', message: '必须是 0 到硬上限之间的整数。' })
    }
    if (!Array.isArray(clarification.askedFields)) {
      errors.push({ path: 'generationSpec.clarification.askedFields', message: '必须是字符串数组。' })
    } else {
      requireStringList(clarification.askedFields, 'generationSpec.clarification.askedFields', errors, 8, 64)
    }
    if (clarification.pendingField !== null && clarification.pendingField !== undefined) {
      requireShortString(clarification.pendingField, 'generationSpec.clarification.pendingField', errors, 64)
    }
  }
  const confirmation = requireObject(value.confirmation, 'generationSpec.confirmation', errors)
  if (confirmation) {
    hasOnlyKeys(confirmation, ['status', 'confirmedAt'], 'generationSpec.confirmation', errors)
    if (!GENERATION_CONFIRMATION_STATUSES.includes(confirmation.status as (typeof GENERATION_CONFIRMATION_STATUSES)[number])) {
      errors.push({ path: 'generationSpec.confirmation.status', message: '必须是 unconfirmed 或 confirmed。' })
    }
    if (confirmation.confirmedAt !== null) requireUtcTimestamp(confirmation.confirmedAt, 'generationSpec.confirmation.confirmedAt', errors)
    if (confirmation.status === 'unconfirmed' && confirmation.confirmedAt !== null) {
      errors.push({ path: 'generationSpec.confirmation.confirmedAt', message: '未确认时 confirmedAt 必须为 null。' })
    }
  }
  return errors.length ? failure(errors) : success(raw as GenerationSpec)
}

export function validateGenerationContentSpec(raw: unknown): ValidationResult<GenerationContentSpec> {
  const errors: ValidationIssue[] = []
  validateGenerationContent(raw, errors)
  return errors.length ? failure(errors) : success(raw as GenerationContentSpec)
}

export function validateRoleConstraintsRecord(raw: unknown, assetRole: unknown): ValidationResult<RoleConstraints> {
  const errors: ValidationIssue[] = []
  validateRoleConstraints(raw, assetRole, errors)
  return errors.length ? failure(errors) : success(raw as RoleConstraints)
}


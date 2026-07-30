/** The only persisted SceneDocument schema version supported by V1. */
export const SCHEMA_VERSION = 1 as const

export type SchemaVersion = typeof SCHEMA_VERSION

/**
 * A UUID is used for production scene, object, draft, and project identifiers.
 * Runtime validation, rather than this alias, enforces its serialized form.
 */
export type Uuid = string

/** A UTC ISO-8601 timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form. */
export type UtcIso8601 = string

export type JsonPrimitive = string | number | boolean | null

/**
 * An application-managed logical resource reference. It is never an arbitrary
 * external URL or an operating-system path.
 */
export type ResourceRef = string

export const ASSET_TYPES = ['background', 'sticker'] as const
export type AssetType = (typeof ASSET_TYPES)[number]

export const ASSET_RUNTIME_STATUSES = ['ready', 'test_only'] as const
export type AssetRuntimeStatus = (typeof ASSET_RUNTIME_STATUSES)[number]

export const ASR_PROVIDERS = [
  'qwen_cloud_http',
  'qwen_cloud_realtime',
  'qwen_local'
] as const
export type AsrProvider = (typeof ASR_PROVIDERS)[number]


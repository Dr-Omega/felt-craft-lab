import type { PersonalAssetRole } from './personal-asset'

/** GenerationSpec is an in-progress creation document, not a persisted Personal Asset. */
export const GENERATION_SPEC_SCHEMA_VERSION = 1 as const
export type GenerationSpecSchemaVersion = typeof GENERATION_SPEC_SCHEMA_VERSION

export const GENERATION_CREATION_MODES = ['guided', 'free'] as const
export type GenerationCreationMode = (typeof GENERATION_CREATION_MODES)[number]

export const GENERATION_CONFIRMATION_STATUSES = ['unconfirmed', 'confirmed'] as const
export type GenerationConfirmationStatus = (typeof GENERATION_CONFIRMATION_STATUSES)[number]

/** Soft fields (action / colors / required / scene) may ask up to this many rounds. */
export const DEFAULT_CLARIFICATION_MAX_ROUNDS = 4
/** Critical gaps (e.g. no subject) may keep asking until this hard cap. */
export const HARD_CLARIFICATION_MAX_ROUNDS = 5

/**
 * Keys that must never appear on GenerationSpec. Prompt text and Provider
 * settings belong to later compiler/adapter stages, not the domain spec.
 */
export const GENERATION_SPEC_POLLUTION_KEYS = [
  'prompt',
  'negativePrompt',
  'canonicalPrompt',
  'provider',
  'providerPrompt',
  'model',
  'apiKey',
  'adapter',
  'temperature',
  'seed',
  'lora',
  'stylePrompt',
  'imageUrl'
] as const

export interface GenerationSubject {
  name: string
  count?: number
  attributes?: string[]
}

export interface GenerationContentSpec {
  primarySubjects: GenerationSubject[]
  actionOrRelationship?: string
  preferredColors?: string[]
  requiredElements?: string[]
  forbiddenElements?: string[]
  environmentDescription?: string
}

export interface CorePatternConstraints {
  role: 'core_pattern'
  keepGroupIntact: true
  simplifyStructure: true
  preferLowOcclusion: true
  preferSameColorContinuity: true
}

export interface ElementConstraints {
  role: 'element'
  independentUnit: true
  avoidUnrelatedObjects: true
  preferSeparableBackground: true
  simplifyStructure: true
}

export interface BackgroundConstraints {
  role: 'background'
  fullFrame: true
  allowSceneObjects: true
  reserveForegroundSpace: true
  avoidHighVisualDensity: true
  requireTransparency: false
  requireCenteredSubject: false
}

export type RoleConstraints = CorePatternConstraints | ElementConstraints | BackgroundConstraints

/**
 * Closed style tokens. These are not prompt sentences and must match the
 * project FeltStyleSpec; children cannot change the base look.
 */
export interface CommonStyleConstraints {
  renderStyle: 'flat_color_block'
  perspective: 'minimal'
  texture: 'none'
  gradient: 'minimal'
  outline: 'none'
  shapeComplexity: 'low'
  occlusion: 'low'
  paletteComplexity: 'limited'
  tinyDetails: 'avoid'
  sameColorContinuity: 'prefer'
  background: 'plain_or_none'
}

export const FELT_COMMON_STYLE_CONSTRAINTS: CommonStyleConstraints = {
  renderStyle: 'flat_color_block',
  perspective: 'minimal',
  texture: 'none',
  gradient: 'minimal',
  outline: 'none',
  shapeComplexity: 'low',
  occlusion: 'low',
  paletteComplexity: 'limited',
  tinyDetails: 'avoid',
  sameColorContinuity: 'prefer',
  background: 'plain_or_none'
}

export interface ThemeContext {
  themeId?: string
}

export interface ClarificationState {
  roundCount: number
  askedFields: string[]
  pendingField: string | null
}

export interface ConfirmationState {
  status: GenerationConfirmationStatus
  confirmedAt: string | null
}

export interface GenerationSpec {
  schemaVersion: GenerationSpecSchemaVersion
  assetRole: PersonalAssetRole
  creationMode: GenerationCreationMode
  themeContext?: ThemeContext
  content: GenerationContentSpec
  roleConstraints: RoleConstraints
  styleConstraints: CommonStyleConstraints
  clarification: ClarificationState
  confirmation: ConfirmationState
}

export type GenerationSpecPatch = {
  assetRole?: PersonalAssetRole
  creationMode?: GenerationCreationMode
  themeContext?: ThemeContext | null
  content?: Partial<GenerationContentSpec> & {
    primarySubjects?: GenerationSubject[]
  }
}

export interface AssetRoleDecision {
  role: PersonalAssetRole | null
  confidence: 'high' | 'medium' | 'low'
  ambiguityReason?: string
}

export const DEFAULT_CORE_PATTERN_CONSTRAINTS: CorePatternConstraints = {
  role: 'core_pattern',
  keepGroupIntact: true,
  simplifyStructure: true,
  preferLowOcclusion: true,
  preferSameColorContinuity: true
}

export const DEFAULT_ELEMENT_CONSTRAINTS: ElementConstraints = {
  role: 'element',
  independentUnit: true,
  avoidUnrelatedObjects: true,
  preferSeparableBackground: true,
  simplifyStructure: true
}

export const DEFAULT_BACKGROUND_CONSTRAINTS: BackgroundConstraints = {
  role: 'background',
  fullFrame: true,
  allowSceneObjects: true,
  reserveForegroundSpace: true,
  avoidHighVisualDensity: true,
  requireTransparency: false,
  requireCenteredSubject: false
}

export function defaultRoleConstraints(role: PersonalAssetRole): RoleConstraints {
  if (role === 'element') return { ...DEFAULT_ELEMENT_CONSTRAINTS }
  if (role === 'background') return { ...DEFAULT_BACKGROUND_CONSTRAINTS }
  return { ...DEFAULT_CORE_PATTERN_CONSTRAINTS }
}

export function createEmptyGenerationSpec(role: PersonalAssetRole): GenerationSpec {
  return {
    schemaVersion: GENERATION_SPEC_SCHEMA_VERSION,
    assetRole: role,
    creationMode: 'guided',
    content: { primarySubjects: [] },
    roleConstraints: defaultRoleConstraints(role),
    styleConstraints: { ...FELT_COMMON_STYLE_CONSTRAINTS },
    clarification: { roundCount: 0, askedFields: [], pendingField: null },
    confirmation: { status: 'unconfirmed', confirmedAt: null }
  }
}

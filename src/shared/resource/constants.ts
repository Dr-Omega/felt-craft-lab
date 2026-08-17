import type { ResourceRefValidationPolicy } from '../contracts/validation'

/** Current verification protocol for application-managed ResourceRef values. */
export const FELT_RESOURCE_PROTOCOL = 'felt-resource:' as const

/** URL scheme name without trailing colon (Electron protocol.register*). */
export const FELT_RESOURCE_SCHEME = 'felt-resource' as const

export const FELT_RESOURCE_KINDS = ['material', 'audio', 'preview', 'personal'] as const
export type FeltResourceKind = (typeof FELT_RESOURCE_KINDS)[number]

/**
 * Policy for contract validators when checking production-style ResourceRef
 * values. Does not replace MOCK_RESOURCE_REF_POLICY used by shared fixtures.
 */
export const FELT_RESOURCE_REF_POLICY: ResourceRefValidationPolicy = {
  allowedProtocols: [FELT_RESOURCE_PROTOCOL]
}

export const FELT_RESOURCE_KIND_SET = new Set<string>(FELT_RESOURCE_KINDS)

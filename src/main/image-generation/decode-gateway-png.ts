import { PNG_SIGNATURE, parseTrustedPngBytes } from '../resource/png'
import type { GenerationQualityReport } from '@shared/contracts/generation-candidate'
import { GENERATION_QUALITY_VERDICTS } from '@shared/contracts/generation-candidate'

const MAX_GATEWAY_IMAGE_PNG_BYTES = 8 * 1024 * 1024

export type DecodeGatewayImageResult =
  | { ok: true; bytes: Buffer; quality?: GenerationQualityReport; width?: number; height?: number }
  | { ok: false }

function readQuality(raw: unknown): GenerationQualityReport | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as { verdict?: unknown; messages?: unknown; metrics?: unknown }
  if (!GENERATION_QUALITY_VERDICTS.includes(value.verdict as (typeof GENERATION_QUALITY_VERDICTS)[number])) {
    return undefined
  }
  const messages = Array.isArray(value.messages)
    ? value.messages.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : []
  return {
    verdict: value.verdict as GenerationQualityReport['verdict'],
    messages,
    ...(value.metrics && typeof value.metrics === 'object'
      ? { metrics: value.metrics as GenerationQualityReport['metrics'] }
      : {})
  }
}

/**
 * Accept only a Gateway image envelope with PNG base64. Never trusts bare strings
 * that are not PNG, and never returns OS paths.
 */
export function decodeGatewayImagePng(body: unknown): DecodeGatewayImageResult {
  if (!body || typeof body !== 'object') return { ok: false }
  const envelope = body as {
    ok?: unknown
    result?: { imageBase64?: unknown; quality?: unknown; width?: unknown; height?: unknown }
  }
  if (envelope.ok !== true) return { ok: false }
  const encoded = envelope.result?.imageBase64
  if (typeof encoded !== 'string' || !encoded.trim()) return { ok: false }

  let bytes: Buffer
  try {
    bytes = Buffer.from(encoded, 'base64')
  } catch {
    return { ok: false }
  }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false }
  }
  const trusted = parseTrustedPngBytes(bytes, MAX_GATEWAY_IMAGE_PNG_BYTES)
  if (!trusted.ok) return { ok: false }
  const quality = readQuality(envelope.result?.quality)
  const width = typeof envelope.result?.width === 'number' ? envelope.result.width : undefined
  const height = typeof envelope.result?.height === 'number' ? envelope.result.height : undefined
  return {
    ok: true,
    bytes: trusted.bytes,
    ...(quality ? { quality } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {})
  }
}
